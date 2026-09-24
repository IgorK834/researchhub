package dev.researchhub.source.application;

import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

/**
 * Counts and hashes what is read through it, and stops once a limit is passed.
 *
 * <p>This is what lets a size limit and a SHA-256 apply to an upload without holding it in memory: the adapter reads
 * the stream in chunks as it writes them out, and every chunk passes through here on the way. The limit is enforced
 * as bytes arrive, so a client that lied about its size — or sent none — is stopped at {@code limit + 1} bytes
 * rather than after the whole body.
 *
 * <p>{@code skip} reads rather than skips, so skipped bytes are still counted and hashed. {@code mark} is not
 * supported: a replayed byte must not be counted twice.
 */
public final class MeteredInputStream extends FilterInputStream {

    private final long limitBytes;
    private final MessageDigest digest;
    private long count;

    public MeteredInputStream(InputStream in, long limitBytes) {
        super(in);
        if (limitBytes < 0) {
            throw new IllegalArgumentException("limitBytes must not be negative");
        }
        this.limitBytes = limitBytes;
        try {
            this.digest = MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("every Java platform provides SHA-256", impossible);
        }
    }

    @Override
    public int read() throws IOException {
        int value = in.read();
        if (value >= 0) {
            record(new byte[]{(byte) value}, 0, 1);
        }
        return value;
    }

    @Override
    public int read(byte[] buffer, int offset, int length) throws IOException {
        int read = in.read(buffer, offset, length);
        if (read > 0) {
            record(buffer, offset, read);
        }
        return read;
    }

    @Override
    public long skip(long n) throws IOException {
        byte[] discard = new byte[(int) Math.min(Math.max(n, 0), 8192)];
        int read = read(discard, 0, discard.length);
        return Math.max(read, 0);
    }

    @Override
    public boolean markSupported() {
        return false;
    }

    @Override
    public synchronized void mark(int readLimit) {
        // Not supported; see the class comment.
    }

    @Override
    public synchronized void reset() throws IOException {
        throw new IOException("mark/reset is not supported");
    }

    private void record(byte[] buffer, int offset, int length) throws ContentLimitExceededException {
        count += length;
        if (count > limitBytes) {
            throw new ContentLimitExceededException(limitBytes);
        }
        digest.update(buffer, offset, length);
    }

    /** Bytes read so far. */
    public long count() {
        return count;
    }

    /** Lowercase hex SHA-256 of everything read. Call once, after the stream has been read to the end. */
    public String sha256Hex() {
        return HexFormat.of().formatHex(digest.digest());
    }

}
