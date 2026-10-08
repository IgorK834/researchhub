package dev.researchhub.export.infrastructure;

import org.springframework.context.annotation.*;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

@Configuration
public class ExportSchedulingConfiguration {
    @Bean("exportScheduler")
    ThreadPoolTaskScheduler exportScheduler() {
        var scheduler=new ThreadPoolTaskScheduler();scheduler.setPoolSize(1);scheduler.setThreadNamePrefix("report-export-");
        scheduler.setWaitForTasksToCompleteOnShutdown(true);scheduler.setAwaitTerminationSeconds(30);return scheduler;
    }
}
