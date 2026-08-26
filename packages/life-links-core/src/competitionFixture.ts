import type {
  ExportBatchRecord,
  LifeLinkProjectCompatibilityRecord,
  LifeLinkQrBindingRecord,
  LifeLinkRecord,
  LinkBodyDoc,
  QrInventoryRecord,
  UserRecord
} from "./index.js";

export const COMPETITION_FIXTURE_PROFILE = "webmcp-camera-kit-v1";
export const COMPETITION_FIXTURE_TIMESTAMP = "2026-08-26T12:00:00.000Z";

export const COMPETITION_OWNER_ID = "competition-owner";
export const COMPETITION_OWNER_EMAIL = "judge@life-links.test";
export const COMPETITION_OWNER_DISPLAY_NAME = "Challenge Judge";

export const COMPETITION_BATCH_ID = "batch-webmcp-challenge";
export const COMPETITION_TARGET_QR_ID = "LL-WEBMCP-00001";
export const COMPETITION_DECOY_QR_ID = "LL-WEBMCP-00002";

export const COMPETITION_FIELD_CAMERA_BAG_ID = "competition-field-camera-bag";
export const COMPETITION_MAIN_COMPARTMENT_ID = "competition-main-compartment";
export const COMPETITION_POWER_POUCH_ID = "competition-power-pouch";
export const COMPETITION_CAMERA_BATTERY_KIT_ID = "competition-camera-battery-kit";
export const COMPETITION_FRONT_ORGANIZER_ID = "competition-front-organizer";
export const COMPETITION_LENS_CLEANING_KIT_ID = "competition-lens-cleaning-kit";

export type CompetitionFixtureData = {
  profile: typeof COMPETITION_FIXTURE_PROFILE;
  owner: UserRecord;
  batch: ExportBatchRecord;
  qrInventory: QrInventoryRecord[];
  lifeLinks: LifeLinkRecord[];
  qrBindings: LifeLinkQrBindingRecord[];
  projectCompatibility: LifeLinkProjectCompatibilityRecord[];
};

const TARGET_BODY = [
  "Battery readiness",
  "Power kit for the field camera.",
  "- [x] Pack two charged batteries",
  "- [ ] Confirm the USB-C charger is in the pouch",
  "- [ ] Add one labeled spare"
].join("\n");

const TARGET_BODY_DOC: LinkBodyDoc = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Battery readiness" }]
    },
    {
      type: "paragraph",
      content: [{ type: "text", text: "Power kit for the field camera." }]
    },
    {
      type: "taskList",
      content: [
        taskItem(true, "Pack two charged batteries"),
        taskItem(false, "Confirm the USB-C charger is in the pouch"),
        taskItem(false, "Add one labeled spare")
      ]
    }
  ]
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
      id: COMPETITION_FIELD_CAMERA_BAG_ID,
      parentId: null,
      title: "Field Camera Bag",
      body: "The complete synthetic field camera kit.",
      privacy: "private"
    }),
    lifeLink({
      id: COMPETITION_MAIN_COMPARTMENT_ID,
      parentId: COMPETITION_FIELD_CAMERA_BAG_ID,
      title: "Main Compartment",
      body: "Primary camera storage inside the field bag.",
      privacy: "private"
    }),
    lifeLink({
      id: COMPETITION_POWER_POUCH_ID,
      parentId: COMPETITION_MAIN_COMPARTMENT_ID,
      title: "Power Pouch",
      body: "Power accessories grouped inside the main compartment.",
      privacy: "private"
    }),
    lifeLink({
      id: COMPETITION_CAMERA_BATTERY_KIT_ID,
      parentId: COMPETITION_POWER_POUCH_ID,
      qrId: COMPETITION_TARGET_QR_ID,
      title: "Camera Battery Kit",
      body: TARGET_BODY,
      bodyDoc: TARGET_BODY_DOC,
      privacy: "public"
    }),
    lifeLink({
      id: COMPETITION_FRONT_ORGANIZER_ID,
      parentId: COMPETITION_FIELD_CAMERA_BAG_ID,
      title: "Front Organizer",
      body: "Quick-access maintenance supplies.",
      privacy: "private"
    }),
    lifeLink({
      id: COMPETITION_LENS_CLEANING_KIT_ID,
      parentId: COMPETITION_FRONT_ORGANIZER_ID,
      qrId: COMPETITION_DECOY_QR_ID,
      title: "Lens Cleaning Kit",
      body: "Synthetic microfiber cloth, air blower, and lens brush.",
      privacy: "public"
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
        lifeLinkId: COMPETITION_CAMERA_BATTERY_KIT_ID,
        boundAt: timestamp
      },
      {
        qrId: COMPETITION_DECOY_QR_ID,
        lifeLinkId: COMPETITION_LENS_CLEANING_KIT_ID,
        boundAt: timestamp
      }
    ],
    projectCompatibility: [
      {
        projectId: COMPETITION_FIELD_CAMERA_BAG_ID,
        lifeLinkId: COMPETITION_FIELD_CAMERA_BAG_ID
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

function taskItem(checked: boolean, text: string) {
  return {
    type: "taskItem",
    attrs: { checked },
    content: [{ type: "paragraph", content: [{ type: "text", text }] }]
  };
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
