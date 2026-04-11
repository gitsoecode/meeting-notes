import { test as base, expect } from "@playwright/test";
import { installMockApi } from "../mock-api";
import { AppPage } from "../pages/app.page";
import { RecordViewPage } from "../pages/record-view.page";
import { MeetingsListPage } from "../pages/meetings-list.page";
import { MeetingDetailPage } from "../pages/meeting-detail.page";
import { PromptsEditorPage } from "../pages/prompts-editor.page";
import { SettingsPage } from "../pages/settings.page";
import { LogsViewPage } from "../pages/logs-view.page";

export interface AuditObservation {
  intent: string;
  expectations: string;
  observations: string[];
  elementCounts?: Record<string, number>;
  screenshotName?: string;
}

type Fixtures = {
  app: AppPage;
  recordView: RecordViewPage;
  meetingsList: MeetingsListPage;
  meetingDetail: MeetingDetailPage;
  promptsEditor: PromptsEditorPage;
  settings: SettingsPage;
  logsView: LogsViewPage;
  audit: (obs: AuditObservation) => Promise<void>;
};

export const test = base.extend<Fixtures>({
  app: async ({ page }, use) => {
    await installMockApi(page);
    const app = new AppPage(page);
    await app.bootstrapHome();
    await use(app);
  },
  recordView: async ({ app }, use) => {
    await use(new RecordViewPage(app.page));
  },
  meetingsList: async ({ app }, use) => {
    await use(new MeetingsListPage(app.page));
  },
  meetingDetail: async ({ app }, use) => {
    await use(new MeetingDetailPage(app.page));
  },
  promptsEditor: async ({ app }, use) => {
    await use(new PromptsEditorPage(app.page));
  },
  settings: async ({ app }, use) => {
    await use(new SettingsPage(app.page));
  },
  logsView: async ({ app }, use) => {
    await use(new LogsViewPage(app.page));
  },
  audit: async ({ app, page }, use) => {
    const auditFn = async (obs: AuditObservation) => {
      const info = [
        `INTENT: ${obs.intent}`,
        `EXPECT: ${obs.expectations}`,
        ...obs.observations.map((o) => `OBSERVE: ${o}`),
      ];
      if (obs.elementCounts) {
        for (const [key, count] of Object.entries(obs.elementCounts)) {
          info.push(`COUNT [${key}]: ${count}`);
        }
      }
      const body = info.join("\n");
      test.info().annotations.push({ type: "ux-audit", description: body });

      if (obs.screenshotName) {
        await page.screenshot({
          path: `test-results/screenshots/${obs.screenshotName}.png`,
          fullPage: true,
        });
      }
    };
    await use(auditFn);
  },
});

export { expect } from "@playwright/test";
