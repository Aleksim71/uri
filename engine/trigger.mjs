// engine/trigger.mjs
//
// Триггер — строка вида domain("аргумент1", "аргумент2").
// Формат намеренно совместим с исходным проектом uri-agent, на случай
// если реестры/сценарии придётся переносить туда-обратно.

function invalid(message) {
  const error = new Error(message);
  error.code = 'TRIGGER_SYNTAX_INVALID';
  throw error;
}

export function parseTrigger(text) {
  if (typeof text !== 'string' || !text.trim()) {
    invalid('Trigger must be a non-empty string');
  }

  const source = text.trim();
  const match = /^([a-z][a-z0-9._-]*)\s*\((.*)\)$/.exec(source);
  if (!match) {
    invalid('Trigger must use lowercase domain("argument", ...) syntax');
  }

  const domain = match[1];
  const body = match[2].trim();
  const args = [];
  let index = 0;

  while (index < body.length) {
    while (/\s/.test(body[index] ?? '')) index += 1;
    if (body[index] !== '"') invalid(`Argument ${args.length + 1} must be quoted`);
    index += 1;

    let value = '';
    let closed = false;
    while (index < body.length) {
      const char = body[index];
      if (char === '\\') {
        const next = body[index + 1];
        if (next !== '"' && next !== '\\') invalid('Unsupported escape sequence');
        value += next;
        index += 2;
        continue;
      }
      if (char === '"') {
        closed = true;
        index += 1;
        break;
      }
      value += char;
      index += 1;
    }
    if (!closed) invalid('Unclosed quoted argument');
    args.push(value);

    while (/\s/.test(body[index] ?? '')) index += 1;
    if (index >= body.length) break;
    if (body[index] !== ',') invalid('Arguments must be separated by commas');
    index += 1;
    if (index >= body.length) invalid('Trigger cannot end with a comma');
  }

  return { domain, arguments: args };
}

export function canonicalTrigger(parsed) {
  const args = parsed.arguments.map((value) => JSON.stringify(value)).join(', ');
  return `${parsed.domain}(${args})`;
}
