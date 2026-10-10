# Uri
[![test](https://github.com/Aleksim71/uri/actions/workflows/test.yml/badge.svg)](https://github.com/Aleksim71/uri/actions/workflows/test.yml)
A deliberately small engine for JSON-defined automation scenarios — and a real
application built on it: a Freelancehunt watcher that polls new projects and
client messages and notifies me via Telegram and email.

The engine is about 400 lines of code (plus comments) in plain Node.js with no dependencies. It is
"dumb" on purpose: it walks a list of acts, looks each one up in a cascade of
registries and hands it to a handler. What success means, what an error means
and what to do next all live in registries and handlers, not in the engine.

```bash
npm install
npm run demo          # happy path with a nested list
npm run demo:error    # a failing act -> onError hook
npm test              # 37 tests, node:test, no extra dependencies
```

Requires Node.js 20.12+.

## How it works

A **scenario** is a list of acts. Each act names a **trigger** —
a string like `demo("say-hello")` or `git("status")`:

```json
{
  "scenarioId": "demo.main.v1",
  "onSuccess": "demo(\"say-hello\")",
  "onError": "demo(\"log-error\")",
  "acts": [
    { "trigger": "demo(\"say-hello\")",    "comment": "Say hello." },
    { "trigger": "demo(\"sub-scenario\")", "comment": "Run a nested list of acts." },
    { "trigger": "demo(\"write-report\")", "comment": "Write a report." }
  ]
}
```

A **registry** maps triggers to what they do. An act is either an `atom`
(an `.mjs` module exporting `async execute()`) or a `list` (another scenario,
expanded in place):

```json
{ "trigger": "demo(\"write-report\")", "kind": "atom", "ref": "handlers/demo/write-report.mjs" }
{ "trigger": "demo(\"sub-scenario\")", "kind": "list", "ref": "scenarios/demo/sub-scenario.json" }
```

Registries form a **cascade**, like CSS: `registries/registry.json` lists them
in order, and the first match wins. Inside one registry an exact match beats a
**wildcard route** such as `git("*")`, which sends any `git(...)` trigger to a
single generic handler that spawns the real command (without a shell).

Each atom goes through two roles:

- the **actor** loads the handler and runs it — it does not judge the result;
- the **critic** turns the result into a directive: `completed → continue`,
  `failed → terminate`. Nothing smarter, on purpose: if retry/escalate logic is
  ever needed, it changes in this one function.

**One failure path.** A throwing handler, an unknown trigger, a missing handler
file, a `ref` outside the project folder or a tripped guard all end the same
way: `{ outcome: "failed", reasonCode }` and the scenario's `onError` hook.
The engine never throws at the caller for a scenario-level problem. A hook's own
result is reported in `result.hook` rather than silently dropped.

**Guards** stop runaway scenarios: max act count, max stack size, max list
depth, and a coarse cycle check (the same trigger more than 3 times in a row).

**Data exchange.** Acts do not call each other or pass return values along.
They exchange data through files in `artifacts/` with agreed names — the
fetch act writes an outbox, the notify acts read it. That keeps every act
independently runnable and testable.

## The real application: Freelancehunt watcher

```bash
cp .env.example .env               # API token, Telegram bot, optional SMTP
npm run poll                       # one run: projects -> Telegram / email
npm run poll:messages              # one run: unread client messages -> Telegram
npm run poll:loop                  # every 15 minutes while the process lives
```

- Uses the **official Freelancehunt REST API** with a personal token — no bot
  login, no scraping.
- Filters by keywords, excluded terms and a budget range converted to EUR —
  all in `config/freelancehunt.json`, no code changes needed.
- Channels are switched on and off in `config/notifications.json`. Each notify
  handler checks its own flag; the engine knows nothing about channels.
- **At-least-once delivery.** New matches are added to an outbox; each channel
  marks an item delivered only after a successful send; an item leaves the
  outbox once every enabled channel has delivered it. A Telegram outage delays
  notifications instead of losing them (see `test/delivery.test.mjs`).
- Notification texts are in Russian: the marketplace is Russian/Ukrainian
  speaking and the notifications are for me.
- For permanent use on a server, a system scheduler (cron / systemd timer) is
  the better choice than `poll-loop.mjs` — it survives restarts.

## Design decisions

The engine started as a larger project (uri-agent) where the actor, the critic
and the stack talked to each other through JSON files on disk. This version
deliberately drops that:

- **No file channels between actor and critic.** Everything runs in one
  process, so the input/output contract can be checked in plain JS. If the
  actor ever moves to a separate worker, real inter-process delivery is
  justified — and should come back deliberately, not in advance.
- **No separate "scenario with steps" format** that existed only to drive that
  technical layer. With the layer in memory, the format is not needed.
- **No deny-list / sandbox yet.** A wildcard like `node("*")` is routing, not a
  security boundary: it also permits `node -e "<code>"`. Today scenarios and
  registries are my own trusted files and the app only calls HTTP APIs, so a
  deny-list would guard against a threat that does not exist. It becomes
  necessary when the engine starts executing untrusted input (e.g. an LLM
  writing and running scripts) — and then isolation comes first, a deny-list
  second.

## Known limitations

- **Cycle detection is a heuristic.** Repeating a trigger is normal for many
  scenarios; "more than 3 in a row" is a safety net, not a real model of what
  a cycle is.
- **Act-level context is empty.** Hooks receive the failure reason; regular
  atoms communicate through `artifacts/` only. This is intentional for now.
- **No scheduling or "job description" layer.** The idea is an engine that
  works on a schedule according to instructions — the scheduler today is
  `poll-loop.mjs` / cron, outside the engine.
- Field names of some Freelancehunt responses (direct project / thread links)
  are not guaranteed by the API docs; the code falls back to known URL patterns.

## Project structure

```
engine/          interpreter (loop, actor, critic, guards), registry cascade,
                 trigger parser, runtime stack, path checks
handlers/        demo/, system/ (terminal commands), freelancehunt/,
                 telegram/, email/ — one async execute() per file
lib/             shared helpers for handlers: outbox, JSON store, API clients
registries/      registry.json (the cascade) + one file per registry
scenarios/       demo/ and freelancehunt/ scenarios
config/          app configuration (keywords, budget, channels)
artifacts/       runtime data, git-ignored
test/            node:test suites
```

## License

MIT
