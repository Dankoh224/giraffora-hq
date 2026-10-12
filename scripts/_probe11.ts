import { chatWithAgent } from "../lib/engine";
(async () => {
  const msg = `Si mira, el martes 20 me invitaron a un evento y vamos a ir con un stand de 9am a 3pm.\n\nEste es el correo de invitación:\n\nJunto con saludar cordialmente, mediante el presente correo queremos invitarle a participar en la Feria de Desarrollo Económico, Educación y Empleabilidad, actividad que se desarrollará el próximo 20 de octubre en la comuna de La Pintana. Esta iniciativa tiene como objetivo acercar oportunidades a la comunidad. Necesito que preparen todo para el stand.`;
  const t0 = Date.now();
  try { const r = await chatWithAgent("jefa-gabinete", msg); console.log(`OK ${(Date.now() - t0) / 1000}s`, r.tools, r.reply.slice(0, 300)); }
  catch (e: any) { console.log(`ERROR tras ${(Date.now() - t0) / 1000}s:`, e.message.slice(0, 1500)); }
})();
