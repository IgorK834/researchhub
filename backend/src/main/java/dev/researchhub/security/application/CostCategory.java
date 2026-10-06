package dev.researchhub.security.application;

/** Independent request budgets; ordinary reads and writes do not consume them. */
public enum CostCategory { LLM, ANALYSIS, RETRIEVAL }
