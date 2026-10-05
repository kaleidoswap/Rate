import { darkTheme, lightTheme } from './index';
import { typeRoles } from './partner';

test('maps slate semantics to both legacy and component theme APIs', () => {
  expect(darkTheme.colors.background.primary).toBe('#12131c');
  expect(darkTheme.colors.surface.primary).toBe('#242638');
  expect(darkTheme.colors.primary[500]).toBe('#15e99a');
  expect(lightTheme.colors.background.primary).toBe('#dadcea');
  expect(lightTheme.colors.primary[500]).toBe('#17b581');
  for (const t of [darkTheme, lightTheme]) {
    expect(t.components.card.default.backgroundColor).toBe(
      t.colors.surface.primary
    );
    expect(t.components.input.focused.borderColor).toBe(t.colors.border.focus);
    expect(t.components.button.primary.backgroundColor).toBe(
      t.colors.primary[500]
    );
    expect(t.borderRadius.lg).toBe(16);
    expect(t.typography.fontSize.base).toBe(typeRoles.body.fontSize);
    // Alpha concatenation remains valid for badges and protocol tints.
    expect(t.colors.info[500] + '26').toMatch(/^#[0-9a-f]{8}$/);
  }
});
