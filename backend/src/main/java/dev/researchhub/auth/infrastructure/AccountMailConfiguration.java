package dev.researchhub.auth.infrastructure;

import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;

@Configuration(proxyBeanMethods=false)
@EnableAsync
public class AccountMailConfiguration {}
