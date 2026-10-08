package dev.researchhub.ai.observability;

import java.math.BigDecimal;
import java.util.*;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties("researchhub.ai.diagnostics")
public class AiDiagnosticsProperties {
    private boolean enabled;
    private boolean captureContent;
    private Set<UUID> staffIds = Set.of();
    private List<Rate> rates = List.of();
    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean enabled) { this.enabled = enabled; }
    public boolean isCaptureContent() { return captureContent; }
    public void setCaptureContent(boolean captureContent) { this.captureContent = captureContent; }
    public Set<UUID> getStaffIds() { return staffIds; }
    public void setStaffIds(Set<UUID> ids) { staffIds = Set.copyOf(ids); }
    public List<Rate> getRates() { return rates; }
    public void setRates(List<Rate> rates) {
        var keys = new HashSet<String>();
        for (var rate : rates) if (!keys.add(rate.provider()+":"+rate.model()+":"+rate.modelVersion()))
            throw new IllegalArgumentException("Duplicate AI price rate");
        this.rates = List.copyOf(rates);
    }
    public boolean staff(UUID caller) { return enabled && staffIds.contains(caller); }
    public record Rate(String provider, String model, String modelVersion, String version,
        BigDecimal inputUsdPerMillion, BigDecimal outputUsdPerMillion) {
        public Rate {
            for (var value : List.of(provider, model, modelVersion, version))
                if (value.isBlank() || value.length()>128) throw new IllegalArgumentException("Invalid AI price identity");
            for (var value : List.of(inputUsdPerMillion, outputUsdPerMillion))
                if (value.signum()<0 || value.compareTo(new BigDecimal("1000000"))>0)
                    throw new IllegalArgumentException("Invalid AI token price");
        }
    }
    public AiDiagnostics.Cost estimate(AiDiagnostics.ProviderUsage value) {
        if (value == null || value.model() == null || value.usage() == null) return null;
        return rates.stream().filter(r -> r.provider().equals(value.model().provider()) && r.model().equals(value.model().name())
            && r.modelVersion().equals(value.model().version())).findFirst().map(r -> new AiDiagnostics.Cost(
                r.inputUsdPerMillion().multiply(BigDecimal.valueOf(value.usage().inputTokens()))
                    .add(r.outputUsdPerMillion().multiply(BigDecimal.valueOf(value.usage().outputTokens())))
                    .movePointLeft(6).setScale(10, java.math.RoundingMode.HALF_UP), r.version(), true)).orElse(null);
    }
}
