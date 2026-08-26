import type {
  ExportBatchRecord,
  LifeLinkProjectCompatibilityRecord,
  LifeLinkQrBindingRecord,
  LifeLinkRecord,
  LinkBodyDoc,
  QrInventoryRecord,
  UserRecord
} from "./index.js";

export const COMPETITION_FIXTURE_PROFILE = "webmcp-camping-context-v1";
export const COMPETITION_FIXTURE_TIMESTAMP = "2026-08-26T12:00:00.000Z";

export const COMPETITION_OWNER_ID = "competition-owner";
export const COMPETITION_OWNER_EMAIL = "judge@life-links.test";
export const COMPETITION_OWNER_DISPLAY_NAME = "Challenge Judge";

export const COMPETITION_BATCH_ID = "batch-webmcp-challenge";
export const COMPETITION_TARGET_QR_ID = "LL-WEBMCP-00001";
export const COMPETITION_DECOY_QR_ID = "LL-WEBMCP-00002";

export const COMPETITION_CAMPING_KIT_ID = "competition-camping-kit";
export const COMPETITION_SLEEP_SYSTEM_ID = "competition-sleep-system";
export const COMPETITION_SLEEPING_BAG_ID = "competition-sleeping-bag";
export const COMPETITION_SLEEPING_PAD_ID = "competition-sleeping-pad";
export const COMPETITION_UPGRADE_PREFERENCES_ID = "competition-upgrade-preferences";
export const COMPETITION_UPGRADE_PLAN_ID = "competition-upgrade-plan";

export const COMPETITION_INITIAL_UPGRADE_PLAN_BODY =
  "Planned: No camping upgrade priority has been selected. Nothing has been purchased, owned, or installed.";

export const COMPETITION_RECOMMENDED_UPGRADE_PLAN_BODY = [
  "Planned upgrade priority: sleeping pad.",
  "",
  "Reason: The current low-R pad caused cold through the ground, while the existing sleeping bag kept me warm around 35°F and still works.",
  "",
  "Requirements: prioritize warmth over minimum weight; stay within the $250 budget; keep the working sleeping bag.",
  "",
  "Status: planned only — not purchased, owned, or installed."
].join("\n");

export type CompetitionFixtureData = {
  profile: typeof COMPETITION_FIXTURE_PROFILE;
  owner: UserRecord;
  batch: ExportBatchRecord;
  qrInventory: QrInventoryRecord[];
  lifeLinks: LifeLinkRecord[];
  qrBindings: LifeLinkQrBindingRecord[];
  projectCompatibility: LifeLinkProjectCompatibilityRecord[];
};

export function createCompetitionFixtureData(password: string, qrBaseUrl: string): CompetitionFixtureData {
  if (!password) {
    throw new Error("Competition fixture password is required.");
  }
  const cleanQrBaseUrl = normalizeQrBaseUrl(qrBaseUrl);
  const timestamp = COMPETITION_FIXTURE_TIMESTAMP;
  const owner: CompetitionFixtureData["owner"] = {
    id: COMPETITION_OWNER_ID,
    email: COMPETITION_OWNER_EMAIL,
    displayName: COMPETITION_OWNER_DISPLAY_NAME,
    createdAt: timestamp
  };
  const batch: ExportBatchRecord = {
    id: COMPETITION_BATCH_ID,
    batchKey: "WEBMCP-CHALLENGE",
    qrBaseUrl: cleanQrBaseUrl,
    count: 2,
    createdBy: owner.id,
    createdAt: timestamp
  };
  const qrInventory: QrInventoryRecord[] = [COMPETITION_TARGET_QR_ID, COMPETITION_DECOY_QR_ID].map((id) => ({
    id,
    url: `${cleanQrBaseUrl}/qr/${encodeURIComponent(id)}`,
    batchId: batch.id,
    createdAt: timestamp
  }));
  const lifeLinks: LifeLinkRecord[] = [
    lifeLink({
      id: COMPETITION_CAMPING_KIT_ID,
      parentId: null,
      title: "Camping Kit",
      body: "Synthetic camping context selected for the WebMCP challenge demonstration.",
      privacy: "private"
    }),
    lifeLink({
      id: COMPETITION_SLEEP_SYSTEM_ID,
      parentId: COMPETITION_CAMPING_KIT_ID,
      title: "Camping Sleep System",
      body: "Recorded context for the current sleeping bag, sleeping pad, and prior trip results.",
      privacy: "private"
    }),
    lifeLink({
      id: COMPETITION_SLEEPING_BAG_ID,
      parentId: COMPETITION_SLEEP_SYSTEM_ID,
      qrId: COMPETITION_TARGET_QR_ID,
      title: "Camping Sleeping Bag",
      body: "Recorded current: This working sleeping bag kept me warm around 35°F. Owner does not want to replace gear that works.",
      privacy: "public"
    }),
    lifeLink({
      id: COMPETITION_SLEEPING_PAD_ID,
      parentId: COMPETITION_SLEEP_SYSTEM_ID,
      qrId: COMPETITION_DECOY_QR_ID,
      title: "Camping Sleeping Pad",
      body: "Owner report: Cold came through the ground on the last trip. Recorded current: low-R sleeping pad.",
      privacy: "private"
    }),
    lifeLink({
      id: COMPETITION_UPGRADE_PREFERENCES_ID,
      parentId: COMPETITION_CAMPING_KIT_ID,
      title: "Camping Upgrade Preferences",
      body: "Owner preference: warmth matters more than minimum weight. Budget for the next camping upgrade: $250.",
      privacy: "private"
    }),
    lifeLink({
      id: COMPETITION_UPGRADE_PLAN_ID,
      parentId: COMPETITION_CAMPING_KIT_ID,
      title: "Camping Upgrade Plan",
      body: COMPETITION_INITIAL_UPGRADE_PLAN_BODY,
      privacy: "private"
    })
  ];
  return {
    profile: COMPETITION_FIXTURE_PROFILE,
    owner,
    batch,
    qrInventory,
    lifeLinks,
    qrBindings: [
      {
        qrId: COMPETITION_TARGET_QR_ID,
        lifeLinkId: COMPETITION_SLEEPING_BAG_ID,
        boundAt: timestamp
      },
      {
        qrId: COMPETITION_DECOY_QR_ID,
        lifeLinkId: COMPETITION_SLEEPING_PAD_ID,
        boundAt: timestamp
      }
    ],
    projectCompatibility: [
      {
        projectId: COMPETITION_CAMPING_KIT_ID,
        lifeLinkId: COMPETITION_CAMPING_KIT_ID
      }
    ]
  };

  function lifeLink(input: {
    id: string;
    parentId: string | null;
    qrId?: string;
    title: string;
    body: string;
    bodyDoc?: LinkBodyDoc;
    privacy: LifeLinkRecord["privacy"];
  }): LifeLinkRecord {
    return {
      id: input.id,
      ownerId: owner.id,
      parentId: input.parentId,
      qrId: input.qrId ?? null,
      title: input.title,
      body: input.body,
      bodyDoc: input.bodyDoc ?? plainBodyDoc(input.body),
      bodyDocVersion: 1,
      privacy: input.privacy,
      media: [],
      createdAt: timestamp,
      updatedAt: timestamp
    };
  }
}

function plainBodyDoc(body: string): LinkBodyDoc {
  return body
    ? { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: body }] }] }
    : { type: "doc" };
}

function normalizeQrBaseUrl(value: string): string {
  const clean = value.trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(clean);
  } catch {
    throw new Error("Competition fixture QR base URL must be an absolute HTTP(S) URL.");
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname) {
    throw new Error("Competition fixture QR base URL must be an absolute HTTP(S) URL.");
  }
  return clean;
}
