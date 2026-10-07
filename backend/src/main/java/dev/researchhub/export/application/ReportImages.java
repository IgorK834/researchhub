package dev.researchhub.export.application;

import dev.researchhub.export.domain.Report.*;
import java.io.*;
import java.util.*;
import javax.imageio.ImageIO;
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;
import org.apache.batik.transcoder.TranscoderInput;
import org.apache.batik.transcoder.TranscoderOutput;
import org.apache.batik.transcoder.image.PNGTranscoder;
import org.w3c.dom.Element;

/** Bounded rasterization prevents external resource access and image decompression bombs. */
public final class ReportImages {
    private ReportImages() {}
    public static Image normalize(byte[] bytes,String mediaType,String alt,String caption,AnalysisProvenance provenance) {
        if (bytes.length==0 || bytes.length>8*1024*1024) throw new IllegalArgumentException("Invalid image size");
        try {
            if ("image/svg+xml".equals(mediaType)) bytes=rasterize(bytes);
            else if (!Set.of("image/png","image/jpeg").contains(mediaType)) throw new IllegalArgumentException("Unsupported image type");
            try (var input=ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))) {
                var readers=ImageIO.getImageReaders(input);
                if (!readers.hasNext()) throw new IllegalArgumentException("Invalid image");
                var reader=readers.next();
                try {
                    reader.setInput(input);
                    int width=reader.getWidth(0),height=reader.getHeight(0);
                    if (width<1 || height<1 || (long)width*height>16_000_000 || width>16000 || height>16000)
                        throw new IllegalArgumentException("Invalid image dimensions");
                    var png=new ByteArrayOutputStream();
                    ImageIO.write(reader.read(0),"png",png);
                    if (png.size()>8*1024*1024) throw new IllegalArgumentException("Invalid image size");
                    return new Image(Base64.getEncoder().encodeToString(png.toByteArray()),width,height,alt,caption,provenance);
                } finally { reader.dispose(); }
            }
        } catch (IllegalArgumentException invalid) { throw invalid; }
        catch (Exception invalid) { throw new IllegalArgumentException("Image cannot be rendered",invalid); }
    }
    private static byte[] rasterize(byte[] svg) throws Exception {
        var factory=DocumentBuilderFactory.newInstance();factory.setNamespaceAware(true);
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl",true);
        factory.setFeature("http://xml.org/sax/features/external-general-entities",false);
        factory.setFeature("http://xml.org/sax/features/external-parameter-entities",false);
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD,"");factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA,"");
        var parser=factory.newDocumentBuilder();parser.setErrorHandler(new org.xml.sax.helpers.DefaultHandler());
        var document=parser.parse(new ByteArrayInputStream(svg));var root=document.getDocumentElement();
        if (!"svg".equals(root.getLocalName())) throw new IllegalArgumentException("Invalid SVG");
        inspect(root,0,new int[]{0});
        var transcoder=new PNGTranscoder();
        transcoder.addTranscodingHint(PNGTranscoder.KEY_ALLOW_EXTERNAL_RESOURCES,false);
        transcoder.addTranscodingHint(PNGTranscoder.KEY_EXECUTE_ONLOAD,false);
        transcoder.addTranscodingHint(PNGTranscoder.KEY_MAX_WIDTH,1600f);
        transcoder.addTranscodingHint(PNGTranscoder.KEY_MAX_HEIGHT,1200f);
        var output=new ByteArrayOutputStream();
        transcoder.transcode(new TranscoderInput(document),new TranscoderOutput(output));
        return output.toByteArray();
    }
    private static void inspect(Element element,int depth,int[] count) {
        if (depth>32 || ++count[0]>50000 || !"http://www.w3.org/2000/svg".equals(element.getNamespaceURI())
            || !Set.of("svg","g","path","rect","circle","ellipse","line","polyline","polygon","text","tspan","defs","clipPath","linearGradient","radialGradient","stop","title","desc","use").contains(element.getLocalName()))
            throw new IllegalArgumentException("Unsafe SVG");
        var attrs=element.getAttributes();
        for (int i=0;i<attrs.getLength();i++) {
            var a=attrs.item(i);String name=a.getNodeName().toLowerCase(Locale.ROOT);
            String value=a.getNodeValue().toLowerCase(Locale.ROOT).replaceAll("\\s","");
            if (name.startsWith("xmlns")) continue;
            if (name.startsWith("on") || name.equals("xml:base") || name.endsWith("href") && !value.matches("#[a-z0-9_-]+")
                || value.contains("http:") || value.contains("https:") || value.contains("file:") || value.contains("data:")
                || value.contains("javascript:") || value.contains("@import") || value.contains("url(") && !value.matches("url\\(#[a-z0-9_-]+\\)"))
                throw new IllegalArgumentException("Unsafe SVG resource");
        }
        for (var child=element.getFirstChild();child!=null;child=child.getNextSibling())
            if (child instanceof Element nested) inspect(nested,depth+1,count);
    }
}
