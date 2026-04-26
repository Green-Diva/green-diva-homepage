export function format(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) =>
    k in vars ? String(vars[k]) : `{{${k}}}`,
  );
}
