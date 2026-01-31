# Troubleshooting Guide

Common issues and solutions when using spec-gen.

## Installation Issues

### Skill Not Found

**Problem**: `/spec-gen` command not recognized

**Solution**:
1. Verify the skill file exists:
   ```bash
   ls -la .claude/skills/spec-gen.md
   ```
2. Check file permissions are readable
3. Restart Claude Code session
4. Ensure you're in the correct project directory

### Permission Denied

**Problem**: Can't create `.claude/skills/` directory

**Solution**:
```bash
mkdir -p .claude/skills
chmod 755 .claude/skills
```

## Generation Issues

### No Domains Detected

**Problem**: spec-gen says "Could not identify any domains"

**Possible Causes**:
1. Very flat project structure
2. Unconventional naming patterns
3. Monolithic codebase without clear separation

**Solutions**:
- Ensure project has some directory structure
- Check that source files aren't all in root
- Consider manual domain hints in instructions:
  ```
  /spec-gen
  Consider these domains: user, order, payment
  ```

### Too Many Domains Generated

**Problem**: spec-gen creates specs for every directory

**Solution**: Add guidance to limit scope:
```
/spec-gen
Focus on core business domains only. Ignore utilities, helpers, and infrastructure.
```

### Empty or Minimal Specs

**Problem**: Generated specs have very few requirements

**Possible Causes**:
1. Limited code in analyzed files
2. Heavy use of external libraries
3. Generated/compiled code being analyzed

**Solutions**:
- Point to source files, not build output
- Ensure `.gitignore` patterns are respected
- Check that high-value files (models, services) exist

### Incorrect Requirements

**Problem**: Generated requirements don't match actual code behavior

**This is expected sometimes**. Remember: "Archaeology over Creativity" means we should flag uncertainty rather than guess.

**Solutions**:
1. Review and edit generated specs manually
2. Add `**Confidence**: Low` markers
3. Remove requirements that can't be verified
4. File an issue if patterns consistently fail

## Format Issues

### OpenSpec Validation Fails

**Problem**: `openspec validate --all` reports errors

**Common Issues**:

1. **Missing RFC 2119 keywords**
   ```
   Error: Requirement doesn't use SHALL/MUST/SHOULD/MAY
   ```
   Fix: Edit requirement to include keyword:
   ```markdown
   The system SHALL validate email format.
   ```

2. **Wrong scenario heading level**
   ```
   Error: Scenario must use #### heading
   ```
   Fix: Ensure scenarios use exactly 4 hashtags:
   ```markdown
   #### Scenario: ValidEmail
   ```

3. **Missing Given/When/Then**
   ```
   Error: Scenario missing required format
   ```
   Fix: Ensure all three parts exist with bold labels:
   ```markdown
   - **GIVEN** precondition
   - **WHEN** action
   - **THEN** outcome
   ```

### Markdown Rendering Issues

**Problem**: Specs don't render correctly in viewers

**Solutions**:
- Ensure blank lines before/after code blocks
- Check for unclosed formatting (**, `, etc.)
- Verify heading hierarchy is correct

## Performance Issues

### Generation Takes Too Long

**Problem**: spec-gen seems stuck or very slow

**Possible Causes**:
1. Very large codebase
2. Too many files being analyzed
3. Deep directory nesting

**Solutions**:
- Add exclusions for large directories:
  ```
  /spec-gen
  Exclude: node_modules, dist, build, coverage, .git
  ```
- Focus on specific directories:
  ```
  /spec-gen
  Focus on src/core and src/services only
  ```

### Out of Context Errors

**Problem**: Claude Code runs out of context during generation

**Solutions**:
1. Split into multiple runs by domain
2. Reduce scope per run
3. Use the agents.md approach which can work incrementally

## Integration Issues

### Existing OpenSpec Conflict

**Problem**: spec-gen overwrites existing specs

**Solution**: The tool should backup existing files, but you can also:
```
/spec-gen
Do not overwrite existing specs. Only create new ones.
```

### Config.yaml Conflicts

**Problem**: spec-gen changes break existing config

**Solution**: Review changes before accepting:
```
/spec-gen
Show me what you would add to config.yaml before making changes.
```

## Getting Help

### Still Stuck?

1. **Check the docs**:
   - [Philosophy](./PHILOSOPHY.md) — Understanding the approach
   - [OpenSpec Format](./OPENSPEC-FORMAT.md) — Format reference

2. **File an issue**:
   - Include: Project type, error message, relevant code structure
   - Don't include: Sensitive code or credentials

3. **Try manual approach**:
   - Use the spec format reference
   - Write specs manually for problematic areas
   - Let spec-gen handle the clearer parts

## Known Limitations

1. **Language Support**
   - Best: JavaScript/TypeScript
   - Good: Python
   - Basic: Go, Rust, Java
   - Limited: Other languages

2. **Framework Detection**
   - Well-supported: Express, NestJS, FastAPI, Django
   - Partial: Many others
   - Detection is heuristic-based

3. **Complex Architectures**
   - Microservices: May need per-service runs
   - Monorepos: Focus on specific packages
   - Plugin systems: May miss dynamic behavior

4. **Dynamic Behavior**
   - Runtime configuration not detected
   - Reflection/metaprogramming may be missed
   - Database-driven logic not captured
