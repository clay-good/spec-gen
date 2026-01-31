# Philosophy: Archaeology over Creativity

## The Core Principle

**"Archaeology over Creativity"** — We extract the truth of what code does, grounded in static analysis, not hallucination.

When reverse-engineering specifications from existing code, the goal is documentation, not invention. We document what IS, not what SHOULD BE.

## Why This Matters

### The Hallucination Problem

LLMs are creative by nature. Given incomplete information, they fill gaps with plausible-sounding content. This is dangerous when documenting existing systems:

- Invented features that don't exist
- Assumed behaviors that never happen
- Imagined integrations that aren't real

### The Solution: Evidence-Based Specs

Every requirement and scenario in generated specs must trace back to actual code:

```markdown
### Requirement: UserEmailValidation

The system SHALL validate email format before creating user accounts.

#### Scenario: InvalidEmailRejected
- **GIVEN** a registration request with email "not-an-email"
- **WHEN** the user creation endpoint is called
- **THEN** the request fails with validation error

## Technical Notes

- **Implementation**: `src/validators/email.ts:15-30`
- **Evidence**: Regex validation in validateEmail() function
```

The "Evidence" field is key — it points to the exact code that supports this requirement.

## Practical Guidelines

### DO: Document Observable Behavior

✅ "The system validates email format using regex pattern X"
✅ "User passwords are hashed with bcrypt (12 rounds)"
✅ "The API returns 404 for non-existent resources"

### DON'T: Invent Intended Behavior

❌ "The system should validate email format"
❌ "Passwords should be securely hashed"
❌ "The API should handle errors gracefully"

### DO: Note Uncertainty

When code behavior is ambiguous, say so:

```markdown
### Requirement: SessionTimeout

The system appears to implement session timeouts, though the exact duration is not clearly defined in code.

**Confidence**: Low
**Evidence**: `src/middleware/auth.ts` references `SESSION_TIMEOUT` but value not found
```

### DON'T: Guess at Intent

If you can't verify it from code, don't include it. Missing documentation is better than wrong documentation.

## The Three-Pass Approach

### Pass 1: Survey (What exists?)
- Directory structure
- File types and naming patterns
- Dependencies and frameworks
- Entry points

### Pass 2: Analyze (What does it do?)
- Parse high-value files
- Extract entities and relationships
- Identify operations and flows
- Map dependencies

### Pass 3: Document (What can we prove?)
- Only document verified behavior
- Link every requirement to code
- Note confidence levels
- Flag ambiguities

## Quality Indicators

### High-Confidence Specs
- Clear code evidence
- Explicit behavior in source
- Test coverage confirms behavior
- Comments/docs align with code

### Low-Confidence Specs
- Behavior inferred from patterns
- No direct code evidence
- Missing test coverage
- Conflicting signals

## When in Doubt

1. **Skip it** — Incomplete is better than wrong
2. **Flag it** — Mark as "needs verification"
3. **Ask** — Human review is valuable

## The Goal

Generated specs should be:

1. **Accurate** — Every statement is verifiable
2. **Useful** — Provides real understanding
3. **Maintainable** — Easy to update as code changes
4. **Honest** — Acknowledges limitations

Remember: We're archaeologists documenting ancient ruins, not architects designing new buildings. Our job is to understand and record what exists, not to imagine what could be.
