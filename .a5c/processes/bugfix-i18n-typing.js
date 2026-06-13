/**
 * @process teleglance/bugfix-i18n-typing
 * @description Diagnose and fix two bugs: (1) language change doesn't translate phone UI instructions, (2) no typing indicator after recording+send. Harness-test-driven: repro first, fix, validate.
 * @skill vitest specializations/web-development/skills/vitest/SKILL.md
 */

const { defineTask } = require('@a5c-ai/babysitter-sdk');

// ============================================================================
// TASK DEFINITIONS
// ============================================================================

const diagnosisTask = defineTask('diagnose-both-issues', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Phase 1: Diagnose both issues and write failing harness tests',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Debug engineer',
      task: 'Diagnose two bugs and write failing harness tests that reproduce them',
      context: { ...args },
      instructions: [
        'BUG 1 — Language change not translating phone UI:',
        '  - The locale system is a module-level singleton (getLocale/setLocale in web/src/locales/index.ts).',
        '  - When user changes language in Settings and saves, AppContext.handleSaveSettings calls setLocale() and controller.rebuildGlasses().',
        '  - The glasses text DOES translate (model.ts calls getLocale() on each render).',
        '  - But the phone React UI (App.tsx header, ChatScreen.tsx state descriptions, auth forms, composer) hardcodes English strings — it never imports getLocale().',
        '  - Additionally, setLocale() mutates a module singleton — React has no signal to re-render. Components that DO call getLocale() only see the change if they re-render for another reason.',
        '  - Write failing tests in web/test/ that verify: (a) App.tsx header text changes when locale changes, (b) ChatScreen state descriptions reflect current locale.',
        '',
        'BUG 2 — No typing indicator after recording+send:',
        '  - Typing indicator is inbound-only via SSE TypingUpdate events (web/src/api.ts subscribeUpdates).',
        '  - handleTelegramTypingUpdate (appController.ts) requires screen === "sidebar" && focus === "messages" + updateMatchesThread.',
        '  - After recording+send, the state goes through: sidebarRecording → sidebarTranscribing → sidebarConfirm → sidebarSending → sidebarSent → sidebar/messages.',
        '  - Possible cause: the transition back to sidebar/messages after send doesn\'t properly reconnect typing processing, or the SSE stream is disconnected during the recording flow.',
        '  - Write failing harness tests that verify: after a send completes and state returns to sidebar/messages, an incoming typing update triggers the typing indicator in the model/snapshot.',
        '',
        'IMPORTANT:',
        '  - Do NOT fix the bugs yet. Only diagnose and write tests that FAIL (verify they fail).',
        '  - Use vitest (npm test --prefix web) for unit tests.',
        '  - Use the existing test infrastructure: controller.test.ts, model.test.ts, etc.',
        '  - For typing, inject typing via fixtureApi.injectTyping in controller test.',
        '  - For i18n, test that model/setLocale integration works, and test phone UI component localization.',
        '  - Run the tests to confirm they FAIL before returning.',
        '  - Return: test file paths, what each test verifies, and confirmation that tests fail as expected.'
      ],
      outputFormat: 'JSON'
    },
    outputSchema: {
      type: 'object',
      required: ['diagnosis', 'testsWritten', 'testResults'],
      properties: {
        diagnosis: { type: 'object' },
        testsWritten: { type: 'array', items: { type: 'string' } },
        testResults: { type: 'object' }
      }
    }
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`
  }
}));

const fixIssuesTask = defineTask('fix-both-issues', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Phase 2: Fix both issues',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Senior engineer',
      task: 'Fix both bugs so the failing tests pass',
      context: { diagnosis: args.diagnosis, testResults: args.testResults },
      instructions: [
        'Fix BUG 1 — Language change not translating phone UI:',
        '  1. Add a locale change notification mechanism so React re-renders when language changes.',
        '     Simplest correct approach: add `localeVersion` to AppContext state, increment on language change,',
        '     pass to AppShell/ChatScreen so they re-render and call getLocale() again.',
        '  2. Update App.tsx to use getLocale() for all hardcoded English strings.',
        '  3. Update ChatScreen.tsx to use getLocale() for all hardcoded strings.',
        '  4. Add any missing locale keys to en.ts and propagate to other locale files (at minimum spread en).',
        '',
        'Fix BUG 2 — No typing indicator after recording+send:',
        '  1. Diagnose WHY: trace the state transitions after send, check SSE connection, check typing timer.',
        '  2. Apply the minimal fix.',
        '',
        'IMPORTANT:',
        '  - Keep changes minimal — fix the root cause, not symptoms.',
        '  - Run the tests after each fix to confirm they pass.',
        '  - Run npm run typecheck --prefix web after code changes.',
        '  - Return: files changed, root cause for each bug, confirmation that tests pass.'
      ],
      outputFormat: 'JSON'
    },
    outputSchema: {
      type: 'object',
      required: ['bug1Fix', 'bug2Fix', 'filesChanged', 'allTestsPassing'],
      properties: {
        bug1Fix: { type: 'object' },
        bug2Fix: { type: 'object' },
        filesChanged: { type: 'array', items: { type: 'string' } },
        allTestsPassing: { type: 'boolean' }
      }
    }
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`
  }
}));

const validateHarnessTask = defineTask('validate-harness', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Phase 3: Validate fixes through harness tests',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'QA engineer',
      task: 'Validate both fixes through the full test suite and simulator harness',
      context: { fixes: args },
      instructions: [
        'Run the full test suite to validate both fixes:',
        '  1. npm test --prefix web (unit tests including new ones)',
        '  2. npm run typecheck --prefix web (type safety)',
        '  3. npm run test:simulator --prefix web (simulator fixture harness)',
        '',
        'For the simulator harness:',
        '  - Verify that the catalog (UI_INVARIANTS.json) covers language change and typing scenarios',
        '  - If any test fails, diagnose and fix',
        '',
        'Return: all test results, final confirmation that both issues are fixed.'
      ],
      outputFormat: 'JSON'
    },
    outputSchema: {
      type: 'object',
      required: ['unitTestsPassing', 'typeCheckPassing', 'simulatorResult', 'finalVerdict'],
      properties: {
        unitTestsPassing: { type: 'boolean' },
        typeCheckPassing: { type: 'boolean' },
        simulatorResult: { type: 'object' },
        finalVerdict: { type: 'string' }
      }
    }
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`
  }
}));

// ============================================================================
// MAIN PROCESS
// ============================================================================

async function process(inputs, ctx) {
  const { bug1 = 'Language change not translating phone UI', bug2 = 'No typing indicator after recording+send' } = inputs || {};
  const projectDir = '/Users/jalatif-mac-mini/Work/even-telegram';

  // Phase 1: Diagnosis — write failing tests
  const diagnosis = await ctx.task(diagnosisTask, {
    bug1,
    bug2,
    projectDir,
  });

  await ctx.breakpoint({
    question: 'Diagnosis complete. Failing tests written. Review the diagnosis and approve to proceed with fixes?',
    title: 'Diagnosis Review',
    context: {
      runId: ctx.runId,
      diagnosis: diagnosis
    }
  });

  // Phase 2: Fix both issues
  const fixResult = await ctx.task(fixIssuesTask, {
    diagnosis: diagnosis.diagnosis,
    testResults: diagnosis.testResults,
    testsWritten: diagnosis.testsWritten,
    projectDir,
  });

  await ctx.breakpoint({
    question: 'Fixes applied. Tests passing. Review the changes and approve validation?',
    title: 'Fix Review',
    context: {
      runId: ctx.runId,
      fixes: fixResult
    }
  });

  // Phase 3: Validate through harness
  const validation = await ctx.task(validateHarnessTask, {
    bug1Fix: fixResult.bug1Fix,
    bug2Fix: fixResult.bug2Fix,
    filesChanged: fixResult.filesChanged,
    projectDir,
  });

  return {
    success: validation.unitTestsPassing && validation.typeCheckPassing,
    diagnosis,
    fixResult,
    validation
  };
}

module.exports = { process, diagnosisTask, fixIssuesTask, validateHarnessTask };
