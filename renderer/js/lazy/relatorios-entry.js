import { Dashboard } from "../ui/dashboard.js";

/**
 * Entry point separado: chart.js + jspdf só carregam ao abrir Relatórios.
 * Exposto em globalThis para o bundle principal (IIFE) consumir sem ESM.
 */
globalThis.CybhorDashboard = Dashboard;
