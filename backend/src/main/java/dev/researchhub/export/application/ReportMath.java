package dev.researchhub.export.application;

import dev.researchhub.export.domain.Report.MathExpression;
import dev.researchhub.shared.math.MathAst;
import tools.jackson.databind.JsonNode;
import org.scilab.forge.jlatexmath.*;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.util.*;
import javax.imageio.ImageIO;

/** Only the closed AST reaches JLaTeXMath/OMML/TeX. No parser ever receives user notation. */
public final class ReportMath {
    private ReportMath() {}
    public static final String FALLBACK = "Ostrzeżenie: wzór poza zakresem składu. Zachowano czytelny tekst i źródło notacji.";
    public static MathExpression freeze(JsonNode ast) {return freeze(ast,null);}
    public static MathExpression freeze(JsonNode ast,JsonNode verification) {
        String source=MathAst.notation(ast), plain=MathAst.plain(ast);
        try {
            // Size is bounded before allocating the raster. Headless Java; no filesystem/network access.
            var icon=new TeXFormula(tex(ast)).createTeXIcon(TeXConstants.STYLE_DISPLAY,24);
            icon.setInsets(new Insets(4,4,4,4));
            int width=icon.getIconWidth(),height=icon.getIconHeight();
            if(width>1600 || height>512 || width<1 || height<1) return fallback(ast,plain,source,verification);
            var image=new BufferedImage(width,height,BufferedImage.TYPE_INT_RGB);
            var g=image.createGraphics();
            try {g.setColor(Color.WHITE);g.fillRect(0,0,width,height);icon.paintIcon(null,g,0,0);} finally {g.dispose();}
            var out=new ByteArrayOutputStream();ImageIO.write(image,"png",out);
            return new MathExpression(ast.deepCopy(),plain,source,Base64.getEncoder().encodeToString(out.toByteArray()),width,height,null,verification);
        } catch(Exception limited) {return fallback(ast,plain,source,verification);}
    }
    private static MathExpression fallback(JsonNode ast,String plain,String source,JsonNode verification) {
        return new MathExpression(ast.deepCopy(),plain,source,null,0,0,FALLBACK,verification);
    }
    public static String tex(JsonNode ast) {MathAst.notation(ast);return latex(ast);}
    private static String latex(JsonNode n) {
        return switch(n.path("op").asString()) {
            case "symbol" -> {
                String s=n.path("name").asString();
                yield s.matches("[A-Za-z]+[0-9]+") ? "\\mathrm{"+s.replaceAll("[0-9]+$","")+"}_{"+s.replaceAll("^[A-Za-z]+","")+"}" : "\\mathrm{"+s+"}";
            }
            case "number" -> n.path("value").asString();
            case "add","mul" -> {var parts=new ArrayList<String>();for(var a:n.path("args"))parts.add(latex(a));yield "("+String.join(n.path("op").asString().equals("add") ? " + " : " \\cdot ",parts)+")";}
            case "eq" -> latex(n.path("left"))+" = "+latex(n.path("right"));
            case "div" -> "\\frac{"+latex(n.path("left"))+"}{"+latex(n.path("right"))+"}";
            case "pow" -> "{"+latex(n.path("base"))+"}^{"+n.path("exponent").asInt()+"}";
            default -> "\\"+n.path("op").asString()+"{"+latex(n.path("arg"))+"}";
        };
    }
    public static String omml(JsonNode ast) {
        MathAst.notation(ast);
        return "<m:oMath xmlns:m=\"http://schemas.openxmlformats.org/officeDocument/2006/math\">"+office(ast)+"</m:oMath>";
    }
    private static String run(String value) {return "<m:r><m:t>"+value+"</m:t></m:r>";}
    private static String office(JsonNode n) {
        return switch(n.path("op").asString()) {
            case "number" -> run(n.path("value").asString());
            case "symbol" -> {
                String s=n.path("name").asString();
                yield s.matches("[A-Za-z]+[0-9]+") ? "<m:sSub><m:e>"+run(s.replaceAll("[0-9]+$",""))+"</m:e><m:sub>"+run(s.replaceAll("^[A-Za-z]+",""))+"</m:sub></m:sSub>" : run(s);
            }
            case "div" -> "<m:f><m:num>"+office(n.path("left"))+"</m:num><m:den>"+office(n.path("right"))+"</m:den></m:f>";
            case "pow" -> "<m:sSup><m:e>"+office(n.path("base"))+"</m:e><m:sup>"+run(n.path("exponent").asString())+"</m:sup></m:sSup>";
            case "sqrt" -> "<m:rad><m:radPr><m:degHide m:val=\"1\"/></m:radPr><m:deg/><m:e>"+office(n.path("arg"))+"</m:e></m:rad>";
            case "sin","cos" -> run(n.path("op").asString()+"(")+office(n.path("arg"))+run(")");
            case "eq" -> office(n.path("left"))+run(" = ")+office(n.path("right"));
            default -> {var parts=new ArrayList<String>();for(var a:n.path("args"))parts.add(office(a));yield run("(")+String.join(run(n.path("op").asString().equals("add") ? " + " : " · "),parts)+run(")");}
        };
    }
}
