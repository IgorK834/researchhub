package dev.researchhub.security.application;

import java.lang.annotation.*;

/** Explicit admission contract for a public endpoint that invokes a provider or queues analysis. */
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface CostlyOperation {
    CostCategory value();
    Access access() default Access.READ;
    enum Access { READ, EDIT, AI_CONTRIBUTOR }
}
