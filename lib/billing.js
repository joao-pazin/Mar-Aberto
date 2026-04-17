/**
 * Modelo freemium:
 * - Grátis: 1 praia
 * - Pago R$7,90/mês: todas as praias
 */

export const FREE_BEACH_LIMIT = 1;

/**
 * Verifica se o subscriber é premium (pagou)
 */
export function isPremium(subscriber) {
  if (!subscriber || !subscriber.paidUntil) return false;
  return new Date(subscriber.paidUntil) > new Date();
}

/**
 * Retorna as praias que o subscriber pode receber alertas
 * Free: apenas a primeira praia cadastrada
 * Premium: todas
 */
export function getAccessibleBeaches(subscriber) {
  const beaches = subscriber.beaches || [];
  if (isPremium(subscriber)) return beaches;
  return beaches.slice(0, FREE_BEACH_LIMIT);
}

/**
 * Mensagem de upgrade quando tenta adicionar segunda praia
 */
export function buildUpgradeMessage(beachName) {
  return `🔒 *${beachName} é exclusiva do plano Premium.*

No plano gratuito você monitora *1 praia* à sua escolha.

Para desbloquear todas as 17 praias, assine por apenas:

💰 *R$ 7,90 / mês*

${buildPixMessage()}

Após o pagamento, envie o comprovante com /comprovante e libero seu acesso. 🤙`;
}

/**
 * Mensagem completa de upgrade (comando /upgrade)
 */
export function buildFullUpgradeMessage() {
  return `⭐ *Assinar Premium*

No plano gratuito você monitora *1 praia* à sua escolha.

Com o *Premium* você desbloqueia todas as *17 praias* monitoradas:

💰 *R$ 7,90 / mês*

${buildPixMessage()}

Após o pagamento, envie o comprovante com /comprovante e libero seu acesso. 👍`;
}

/**
 * Mensagem de status do plano
 */
export function buildStatusMessage(subscriber) {
  const premium = isPremium(subscriber);
  const beaches = subscriber.beaches || [];

  if (premium) {
    const until = new Date(subscriber.paidUntil).toLocaleDateString('pt-BR');
    return `✅ *Plano Premium ativo*\n📅 Válido até ${until}\n🏖️ ${beaches.length} praias monitoradas`;
  }

  return `🆓 *Plano Gratuito*\n🏖️ 1 praia monitorada: *${beaches[0] || '—'}*\n\nPara desbloquear todas as praias por R$ 7,90/mês:\n${buildPixMessage()}\n\nEnvie o comprovante com /comprovante`;
}

/**
 * Bloco com dados do PIX
 */
export function buildPixMessage() {
  const PIX_KEY = process.env.PIX_KEY || 'sua-chave-pix@email.com';
  const PIX_NAME = process.env.PIX_NAME || 'Mar Aberto';

  return `*Chave PIX:*\n\`${PIX_KEY}\`\n*Beneficiário:* ${PIX_NAME}\n*Valor:* R$ 7,90\n*Descrição:* Mar Aberto Premium - 1 mês`;
}
