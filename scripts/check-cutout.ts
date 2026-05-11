import { prisma } from "../lib/db";

async function main() {
  const skill = await prisma.skill.findUnique({ where: { slug: "meshy-3d-http" } });
  console.log("meshy-3d-http handlerConfig:", JSON.stringify(skill?.handlerConfig, null, 2));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
