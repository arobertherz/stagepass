/**
 * Types for the Stagepass `maintenance` module (`@stagepass/modules/dist/maintenance.min.js`).
 *
 * Enable per project in tsconfig/jsconfig: `"types": ["@stagepass/loader", "@stagepass/modules/maintenance"]`.
 * Only list modules whose script tag is actually on the Webflow site.
 */
import '@stagepass/loader';

export interface StagepassMaintenanceAPI {
  enable: (opts?: { title?: string; text?: string }) => void;
  disable: () => void;
  isActive: () => boolean;
}

declare module '@stagepass/loader' {
  interface StagepassAPI {
    /**
     * Client-side maintenance overlay (`maintenance` module). Not access protection.
     * @example
     * if (sp.maintenance && !sp.maintenance.isActive()) sp.maintenance.enable({ title: 'Back soon' });
     */
    maintenance?: StagepassMaintenanceAPI;
  }
}
