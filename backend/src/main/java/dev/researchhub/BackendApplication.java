package dev.researchhub;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class BackendApplication {

    public static void main(String[] args) {
        SpringApplication application = new SpringApplication(BackendApplication.class);
        if (!profileSelected(args)) {
            application.setAdditionalProfiles("local");
        }
        application.run(args);
    }

    private static boolean profileSelected(String[] args) {
        if (present(System.getenv("SPRING_PROFILES_ACTIVE"))) {
            return true;
        }
        if (present(System.getProperty("spring.profiles.active"))) {
            return true;
        }
        for (String arg : args) {
            if (arg.startsWith("--spring.profiles.active=")) {
                return present(arg.substring("--spring.profiles.active=".length()));
            }
        }
        return false;
    }

    private static boolean present(String value) {
        return value != null && !value.isBlank();
    }

}
