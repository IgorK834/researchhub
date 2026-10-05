package dev.researchhub.analysis.infrastructure;

import java.nio.file.Path;
import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/** Server-owned limits; safety restrictions and the image identity cannot be changed by a request. */
@ConfigurationProperties("researchhub.analysis.sandbox")
public class SandboxProperties {
    private boolean enabled;
    private String socketPath = "/var/run/docker.sock";
    private Duration timeout = Duration.ofSeconds(45);
    private int memoryMiB = 256;
    private int pids = 64;
    private double cpus = 1;
    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean value) { enabled = value; }
    public String getSocketPath() { return socketPath; }
    public void setSocketPath(String value) {
        if (value == null || !Path.of(value).isAbsolute() || value.contains(",") || value.contains("\n") || value.contains("\r"))
            throw new IllegalArgumentException("Sandbox requires an absolute local Docker socket path");
        socketPath = value;
    }
    public Duration getTimeout() { return timeout; }
    public void setTimeout(Duration value) {
        if (value == null || value.isNegative() || value.isZero() || value.compareTo(Duration.ofMinutes(2)) > 0)
            throw new IllegalArgumentException("Sandbox timeout must be positive and at most two minutes");
        timeout = value;
    }
    public int getMemoryMiB() { return memoryMiB; }
    public void setMemoryMiB(int value) {
        if (value < 64 || value > 512) throw new IllegalArgumentException("Sandbox memory must be 64–512 MiB");
        memoryMiB = value;
    }
    public int getPids() { return pids; }
    public void setPids(int value) {
        if (value < 8 || value > 128) throw new IllegalArgumentException("Sandbox PID limit must be 8–128");
        pids = value;
    }
    public double getCpus() { return cpus; }
    public void setCpus(double value) {
        if (!Double.isFinite(value) || value <= 0 || value > 2) throw new IllegalArgumentException("Sandbox CPU limit must be positive and at most two");
        cpus = value;
    }
}
