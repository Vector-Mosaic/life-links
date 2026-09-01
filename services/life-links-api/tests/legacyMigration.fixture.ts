import type { LinkBodyDoc } from "@life-links/core";

const EMPTY_BODY_DOC: LinkBodyDoc = { type: "doc", content: [] };

const CAMERA_BODY_DOC: LinkBodyDoc = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "Camera kit checklist" }]
    },
    {
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { checked: true },
          content: [{ type: "paragraph", content: [{ type: "text", text: "Charge batteries" }] }]
        }
      ]
    }
  ]
};

const HOME_BATTERY_BODY_DOC: LinkBodyDoc = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Two batteries and charger." }] }]
};

const UNGROUPED_BATTERY_BODY_DOC: LinkBodyDoc = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Ungrouped spare pack." }] }]
};

const WORKSHOP_BODY_DOC: LinkBodyDoc = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Workshop tester." }] }]
};

export const REPRESENTATIVE_LEGACY_LIFE_LINKS_SNAPSHOT = {
  projects: [
    {
      id: "project-home",
      ownerId: "owner-alpha",
      name: "Home",
      createdAt: "2026-08-20T10:00:00.000Z"
    },
    {
      id: "project-studio",
      ownerId: "owner-alpha",
      name: "Studio",
      createdAt: "2026-08-20T10:05:00.000Z"
    },
    {
      id: "project-other-owner",
      ownerId: "owner-beta",
      name: "Workshop",
      createdAt: "2026-08-20T10:10:00.000Z"
    }
  ],
  qrCodes: [
    {
      id: "LL-MIG-00001",
      url: "https://challenge.example/qr/LL-MIG-00001",
      status: "claimed",
      batchId: "batch-alpha",
      createdAt: "2026-08-20T11:00:00.000Z",
      claimedAt: "2026-08-21T08:00:00.000Z"
    },
    {
      id: "LL-MIG-00002",
      url: "https://challenge.example/qr/LL-MIG-00002",
      status: "claimed",
      batchId: "batch-alpha",
      createdAt: "2026-08-20T11:01:00.000Z",
      claimedAt: "2026-08-21T08:01:00.000Z"
    },
    {
      id: "LL-MIG-00003",
      url: "https://challenge.example/qr/LL-MIG-00003",
      status: "claimed",
      batchId: "batch-alpha",
      createdAt: "2026-08-20T11:02:00.000Z",
      claimedAt: null
    },
    {
      id: "LL-MIG-00004",
      url: "https://challenge.example/qr/LL-MIG-00004",
      status: "claimed",
      batchId: "batch-beta",
      createdAt: "2026-08-20T11:03:00.000Z",
      claimedAt: "2026-08-21T08:03:00.000Z"
    },
    {
      id: "LL-MIG-00005",
      url: "https://challenge.example/qr/LL-MIG-00005",
      status: "unclaimed",
      batchId: "batch-alpha",
      createdAt: "2026-08-20T11:04:00.000Z",
      claimedAt: null
    }
  ],
  links: [
    {
      qrId: "LL-MIG-00001",
      ownerId: "owner-alpha",
      title: "Battery Kit",
      body: "Camera kit checklist\n- [x] Charge batteries",
      bodyDoc: CAMERA_BODY_DOC,
      bodyDocVersion: 1,
      projectId: "project-studio",
      privacy: "private",
      createdAt: "2026-08-20T11:00:00.000Z",
      updatedAt: "2026-08-24T12:00:00.000Z"
    },
    {
      qrId: "LL-MIG-00002",
      ownerId: "owner-alpha",
      title: "Battery Kit",
      body: "Two batteries and charger.",
      bodyDoc: HOME_BATTERY_BODY_DOC,
      bodyDocVersion: 1,
      projectId: "project-home",
      privacy: "public",
      createdAt: "2026-08-20T11:01:00.000Z",
      updatedAt: "2026-08-24T12:01:00.000Z"
    },
    {
      qrId: "LL-MIG-00003",
      ownerId: "owner-alpha",
      title: "Battery Kit",
      body: "Ungrouped spare pack.",
      bodyDoc: UNGROUPED_BATTERY_BODY_DOC,
      bodyDocVersion: 1,
      projectId: null,
      privacy: "public",
      createdAt: "2026-08-20T11:02:00.000Z",
      updatedAt: "2026-08-24T12:02:00.000Z"
    },
    {
      qrId: "LL-MIG-00004",
      ownerId: "owner-beta",
      title: "Battery Kit",
      body: "Workshop tester.",
      bodyDoc: WORKSHOP_BODY_DOC,
      bodyDocVersion: 1,
      projectId: "project-other-owner",
      privacy: "private",
      createdAt: "2026-08-20T11:03:00.000Z",
      updatedAt: "2026-08-24T12:03:00.000Z"
    }
  ],
  linkMedia: [
    {
      id: "media-camera-photo",
      qrId: "LL-MIG-00001",
      ownerId: "owner-alpha",
      kind: "image",
      mimeType: "image/jpeg",
      fileName: "battery-kit.jpg",
      sizeBytes: 4,
      data: new Uint8Array([222, 173, 190, 239]),
      createdAt: "2026-08-24T13:00:00.000Z"
    },
    {
      id: "media-home-video",
      qrId: "LL-MIG-00002",
      ownerId: "owner-alpha",
      kind: "video",
      mimeType: "video/mp4",
      fileName: "battery-demo.mp4",
      sizeBytes: 3,
      data: new Uint8Array([1, 2, 3]),
      createdAt: "2026-08-24T13:01:00.000Z"
    }
  ],
  claimEvents: [
    {
      commandId: "claim-command-001",
      qrId: "LL-MIG-00001",
      ownerId: "owner-alpha",
      result: "claimed",
      createdAt: "2026-08-21T08:00:00.000Z"
    },
    {
      commandId: "claim-command-002",
      qrId: "LL-MISSING-00001",
      ownerId: "owner-alpha",
      result: "not_found",
      createdAt: "2026-08-21T08:05:00.000Z"
    },
    {
      commandId: "claim-command-003",
      qrId: "LL-MIG-00004",
      ownerId: "owner-alpha",
      result: "not_found",
      createdAt: "2026-08-19T08:00:00.000Z"
    }
  ]
} as const;

// This literal is the reviewed oracle for the legacy-to-canonical migration
// through additive Field Ledger defaults. It is independent of the mapper.
export const EXPECTED_REPRESENTATIVE_CANONICAL_LIFE_LINKS_SNAPSHOT = {
  lifeLinks: [
    {
      id: "legacy-life-link:LL-MIG-00001",
      ownerId: "owner-alpha",
      parentId: "project-studio",
      title: "Battery Kit",
      body: "Camera kit checklist\n- [x] Charge batteries",
      bodyDoc: CAMERA_BODY_DOC,
      bodyDocVersion: 1,
      privacy: "private",
      browsingRole: "item",
      context: { schemaVersion: 1 },
      placementConfirmedAt: null,
      publicFieldKeys: [],
      createdAt: "2026-08-20T11:00:00.000Z",
      updatedAt: "2026-08-24T12:00:00.000Z"
    },
    {
      id: "legacy-life-link:LL-MIG-00002",
      ownerId: "owner-alpha",
      parentId: "project-home",
      title: "Battery Kit",
      body: "Two batteries and charger.",
      bodyDoc: HOME_BATTERY_BODY_DOC,
      bodyDocVersion: 1,
      privacy: "public",
      browsingRole: "item",
      context: { schemaVersion: 1 },
      placementConfirmedAt: null,
      publicFieldKeys: ["notes"],
      createdAt: "2026-08-20T11:01:00.000Z",
      updatedAt: "2026-08-24T12:01:00.000Z"
    },
    {
      id: "legacy-life-link:LL-MIG-00003",
      ownerId: "owner-alpha",
      parentId: null,
      title: "Battery Kit",
      body: "Ungrouped spare pack.",
      bodyDoc: UNGROUPED_BATTERY_BODY_DOC,
      bodyDocVersion: 1,
      privacy: "public",
      browsingRole: "item",
      context: { schemaVersion: 1 },
      placementConfirmedAt: null,
      publicFieldKeys: ["notes"],
      createdAt: "2026-08-20T11:02:00.000Z",
      updatedAt: "2026-08-24T12:02:00.000Z"
    },
    {
      id: "legacy-life-link:LL-MIG-00004",
      ownerId: "owner-beta",
      parentId: "project-other-owner",
      title: "Battery Kit",
      body: "Workshop tester.",
      bodyDoc: WORKSHOP_BODY_DOC,
      bodyDocVersion: 1,
      privacy: "private",
      browsingRole: "item",
      context: { schemaVersion: 1 },
      placementConfirmedAt: null,
      publicFieldKeys: [],
      createdAt: "2026-08-20T11:03:00.000Z",
      updatedAt: "2026-08-24T12:03:00.000Z"
    },
    {
      id: "project-home",
      ownerId: "owner-alpha",
      parentId: null,
      title: "Home",
      body: "",
      bodyDoc: EMPTY_BODY_DOC,
      bodyDocVersion: 1,
      privacy: "private",
      browsingRole: "container",
      context: { schemaVersion: 1 },
      placementConfirmedAt: null,
      publicFieldKeys: [],
      createdAt: "2026-08-20T10:00:00.000Z",
      updatedAt: "2026-08-20T10:00:00.000Z"
    },
    {
      id: "project-other-owner",
      ownerId: "owner-beta",
      parentId: null,
      title: "Workshop",
      body: "",
      bodyDoc: EMPTY_BODY_DOC,
      bodyDocVersion: 1,
      privacy: "private",
      browsingRole: "container",
      context: { schemaVersion: 1 },
      placementConfirmedAt: null,
      publicFieldKeys: [],
      createdAt: "2026-08-20T10:10:00.000Z",
      updatedAt: "2026-08-20T10:10:00.000Z"
    },
    {
      id: "project-studio",
      ownerId: "owner-alpha",
      parentId: null,
      title: "Studio",
      body: "",
      bodyDoc: EMPTY_BODY_DOC,
      bodyDocVersion: 1,
      privacy: "private",
      browsingRole: "container",
      context: { schemaVersion: 1 },
      placementConfirmedAt: null,
      publicFieldKeys: [],
      createdAt: "2026-08-20T10:05:00.000Z",
      updatedAt: "2026-08-20T10:05:00.000Z"
    }
  ],
  qrInventory: [
    {
      id: "LL-MIG-00001",
      url: "https://challenge.example/qr/LL-MIG-00001",
      batchId: "batch-alpha",
      createdAt: "2026-08-20T11:00:00.000Z"
    },
    {
      id: "LL-MIG-00002",
      url: "https://challenge.example/qr/LL-MIG-00002",
      batchId: "batch-alpha",
      createdAt: "2026-08-20T11:01:00.000Z"
    },
    {
      id: "LL-MIG-00003",
      url: "https://challenge.example/qr/LL-MIG-00003",
      batchId: "batch-alpha",
      createdAt: "2026-08-20T11:02:00.000Z"
    },
    {
      id: "LL-MIG-00004",
      url: "https://challenge.example/qr/LL-MIG-00004",
      batchId: "batch-beta",
      createdAt: "2026-08-20T11:03:00.000Z"
    },
    {
      id: "LL-MIG-00005",
      url: "https://challenge.example/qr/LL-MIG-00005",
      batchId: "batch-alpha",
      createdAt: "2026-08-20T11:04:00.000Z"
    }
  ],
  qrBindings: [
    {
      qrId: "LL-MIG-00001",
      lifeLinkId: "legacy-life-link:LL-MIG-00001",
      boundAt: "2026-08-21T08:00:00.000Z"
    },
    {
      qrId: "LL-MIG-00002",
      lifeLinkId: "legacy-life-link:LL-MIG-00002",
      boundAt: "2026-08-21T08:01:00.000Z"
    },
    {
      qrId: "LL-MIG-00003",
      lifeLinkId: "legacy-life-link:LL-MIG-00003",
      boundAt: "2026-08-20T11:02:00.000Z"
    },
    {
      qrId: "LL-MIG-00004",
      lifeLinkId: "legacy-life-link:LL-MIG-00004",
      boundAt: "2026-08-21T08:03:00.000Z"
    }
  ],
  linkMedia: [
    {
      id: "media-camera-photo",
      lifeLinkId: "legacy-life-link:LL-MIG-00001",
      ownerId: "owner-alpha",
      kind: "image",
      mimeType: "image/jpeg",
      fileName: "battery-kit.jpg",
      sizeBytes: 4,
      data: new Uint8Array([222, 173, 190, 239]),
      createdAt: "2026-08-24T13:00:00.000Z"
    },
    {
      id: "media-home-video",
      lifeLinkId: "legacy-life-link:LL-MIG-00002",
      ownerId: "owner-alpha",
      kind: "video",
      mimeType: "video/mp4",
      fileName: "battery-demo.mp4",
      sizeBytes: 3,
      data: new Uint8Array([1, 2, 3]),
      createdAt: "2026-08-24T13:01:00.000Z"
    }
  ],
  claimEvents: [
    {
      commandId: "claim-command-001",
      qrId: "LL-MIG-00001",
      ownerId: "owner-alpha",
      result: "claimed",
      createdAt: "2026-08-21T08:00:00.000Z",
      mode: "create",
      requestedLifeLinkId: null,
      resolvedLifeLinkId: "legacy-life-link:LL-MIG-00001"
    },
    {
      commandId: "claim-command-002",
      qrId: "LL-MISSING-00001",
      ownerId: "owner-alpha",
      result: "not_found",
      createdAt: "2026-08-21T08:05:00.000Z",
      mode: "create",
      requestedLifeLinkId: null,
      resolvedLifeLinkId: null
    },
    {
      commandId: "claim-command-003",
      qrId: "LL-MIG-00004",
      ownerId: "owner-alpha",
      result: "not_found",
      createdAt: "2026-08-19T08:00:00.000Z",
      mode: "create",
      requestedLifeLinkId: null,
      resolvedLifeLinkId: null
    }
  ]
} as const;
