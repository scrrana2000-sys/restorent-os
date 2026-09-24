import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Firestore menu item availability security contract', () => {
  it('allows the live operations online availability toggle field', () => {
    const rules = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');
    const menuItemsBlock = rules.match(/match \/items\/\{itemId\} \{([\s\S]*?)\n\s*\}\n\n\s*\/\/ ==========================================================\n\s*\/\/ TABLES/);
    expect(menuItemsBlock?.[1]).toContain("'isOnlineAvailable'");
  });
});
