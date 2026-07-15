import { detectSignals } from "./signals.js";
import { computeHealth } from "./healthScore.js";
import { computePriority } from "./priorityScore.js";
import { computeOpportunity } from "./opportunityScore.js";
import { nextBestAction } from "./nextBestAction.js";
import { generateInsight } from "./insight.js";
import { ENGINE_VERSION, THRESHOLDS as T } from "./weights.js";

// ═══ SANO INTELLIGENCE ENGINE — orchestrator + data loaders ═══════════════════
// buildCustomerIntelligence = PURE (dari ctx). load* = SATU-SATUNYA akses prisma.

// Susun intelligence lengkap (4 skor terpisah + insight + next action).
export function buildCustomerIntelligence(ctx) {
  const signals = detectSignals(ctx);
  const health = computeHealth(signals);
  const priority = computePriority(signals);
  const opportunity = computeOpportunity(signals);
  const nextAction = nextBestAction(signals);
  const insight = generateInsight(signals, { health });

  return {
    health, priority, opportunity, nextAction, insight,
    // Sinyal yang dipublikasikan (termasuk detectedIntents INERT untuk 4B/4C).
    signals: {
      detectedIntents: signals.detectedIntents,
      stage: signals.stage,
      orderCount: signals.orderCount,
      orderValue: signals.orderValue,
      daysSince: signals.daysSince,
      complaintsOpen: signals.complaintsOpen,
    },
    meta: { engineVersion: ENGINE_VERSION, generatedAt: new Date().toISOString() },
  };
}

// Data yang dimuat untuk 1 customer (order + percakapan terakhir + pesan recent).
const CUSTOMER_SELECT = {
  id: true, name: true, phone: true, pipelineStage: true, assignedSalesId: true, createdAt: true,
  assignedSales: { select: { name: true } },
  orders: { select: { value: true, status: true, hasComplaint: true, createdAt: true } },
  conversations: {
    where: { type: "INDIVIDUAL" }, orderBy: { lastMessageAt: "desc" }, take: 3,
    select: {
      id: true, channel: true, sessionId: true, lastMessageAt: true,
      messages: { orderBy: { createdAt: "desc" }, take: 20, select: { direction: true, content: true, createdAt: true } },
    },
  },
};

export async function loadCustomerContext(prisma, customerId) {
  const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: CUSTOMER_SELECT });
  if (!customer) return null;
  return { customer, conversations: customer.conversations };
}

// Kandidat untuk daftar (bounded, role-scoped). AND menggabungkan role-scope +
// filter kandidat (dua-duanya bisa berisi OR sendiri).
async function loadCandidates(prisma, scope, kind) {
  const roleWhere = scope.isAdmin ? {} : { OR: [{ assignedSalesId: scope.userId }, { assignedSalesId: null }] };
  const recentDays = kind === "opportunity" ? T.opportunityRecentDays : T.candidateRecentDays;
  const recentCut = new Date(Date.now() - recentDays * 86_400_000);

  const where = kind === "opportunity"
    ? { AND: [roleWhere, { pipelineStage: { in: ["QUALIFIED", "QUOTED"] } }, { conversations: { some: { type: "INDIVIDUAL", lastMessageAt: { gt: recentCut } } } }] }
    : { AND: [roleWhere, { OR: [
        { conversations: { some: { type: "INDIVIDUAL", lastMessageAt: { gt: recentCut } } } },
        { orders: { some: { hasComplaint: true } } },
        { pipelineStage: "QUOTED" },
      ] }] };

  return prisma.customer.findMany({ where, select: CUSTOMER_SELECT, take: 80 });
}

export async function buildPriorityList(prisma, scope) {
  const candidates = await loadCandidates(prisma, scope, "priority");
  return candidates
    .map((customer) => {
      const intel = buildCustomerIntelligence({ customer, conversations: customer.conversations });
      return {
        id: customer.id, name: customer.name || "Tanpa nama", phone: customer.phone || "",
        priorityScore: intel.priority.score, reasons: intel.priority.reasons,
        recommendedAction: intel.nextAction.action, urgency: intel.priority.urgency,
        stage: customer.pipelineStage, assignedTo: customer.assignedSales?.name || null,
        sessionLabel: customer.conversations[0]?.sessionId || "CS-1",
      };
    })
    .filter((x) => x.priorityScore > 0)
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, 15);
}

export async function buildOpportunityList(prisma, scope) {
  const candidates = await loadCandidates(prisma, scope, "opportunity");
  return candidates
    .map((customer) => {
      const intel = buildCustomerIntelligence({ customer, conversations: customer.conversations });
      return {
        id: customer.id, name: customer.name || "Tanpa nama", phone: customer.phone || "",
        opportunityScore: intel.opportunity.score, signals: intel.opportunity.signals,
        stage: customer.pipelineStage, valueEstimate: intel.signals.orderValue,
        assignedTo: customer.assignedSales?.name || null,
        sessionLabel: customer.conversations[0]?.sessionId || "CS-1",
      };
    })
    .filter((x) => x.opportunityScore > 0)
    .sort((a, b) => b.opportunityScore - a.opportunityScore)
    .slice(0, 10);
}
