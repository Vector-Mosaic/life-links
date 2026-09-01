import type {
  ExportBatchRecord,
  CollectionRecord,
  CollectionSectionRecord,
  CollectionMembershipRecord,
  CollectionSectionAssignmentRecord,
  LifeLinkContext,
  LifeLinkQrBindingRecord,
  LifeLinkRecord,
  LinkBodyDoc,
  QrInventoryRecord,
  UserRecord
} from "./index.js";

export const COMPETITION_FIXTURE_PROFILE = "webmcp-field-ledger-family-v3";
export const COMPETITION_FIXTURE_TIMESTAMP = "2026-08-29T12:00:00.000Z";

export const COMPETITION_OWNER_ID = "competition-owner";
export const COMPETITION_OWNER_EMAIL = "judge@life-links.test";
export const COMPETITION_OWNER_DISPLAY_NAME = "Challenge Judge";

export const COMPETITION_BATCH_ID = "batch-webmcp-challenge";

export const COMPETITION_SLEEPING_BAG_QR_ID = "LL-WEBMCP-00001";
export const COMPETITION_SLEEPING_PAD_QR_ID = "LL-WEBMCP-00002";
export const COMPETITION_SHELTER_TUB_QR_ID = "LL-WEBMCP-00003";
export const COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_QR_ID = "LL-WEBMCP-00004";
export const COMPETITION_KITCHEN_WATER_TUB_QR_ID = "LL-WEBMCP-00005";
export const COMPETITION_SAFETY_LIGHTING_TUB_QR_ID = "LL-WEBMCP-00006";
export const COMPETITION_HIKING_WEATHER_TUB_QR_ID = "LL-WEBMCP-00007";
export const COMPETITION_CYCLING_REPAIRS_TUB_QR_ID = "LL-WEBMCP-00008";

export const COMPETITION_TARGET_QR_ID = COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_QR_ID;
export const COMPETITION_DECOY_QR_ID = COMPETITION_SHELTER_TUB_QR_ID;
export const COMPETITION_QR_IDS = [
  COMPETITION_SLEEPING_BAG_QR_ID,
  COMPETITION_SLEEPING_PAD_QR_ID,
  COMPETITION_SHELTER_TUB_QR_ID,
  COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_QR_ID,
  COMPETITION_KITCHEN_WATER_TUB_QR_ID,
  COMPETITION_SAFETY_LIGHTING_TUB_QR_ID,
  COMPETITION_HIKING_WEATHER_TUB_QR_ID,
  COMPETITION_CYCLING_REPAIRS_TUB_QR_ID
] as const;

export const COMPETITION_CAMPING_KIT_ID = "competition-camping-kit";
export const COMPETITION_FAMILY_ADVENTURE_GEAR_ID = COMPETITION_CAMPING_KIT_ID;
export const COMPETITION_BASEMENT_GEAR_STORAGE_ID = "competition-basement-gear-storage";
export const COMPETITION_SHELTER_TUB_ID = "competition-shelter-tub";
export const COMPETITION_SLEEP_SYSTEM_ID = "competition-sleep-system";
export const COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_ID = COMPETITION_SLEEP_SYSTEM_ID;
export const COMPETITION_KITCHEN_WATER_TUB_ID = "competition-kitchen-water-tub";
export const COMPETITION_SAFETY_LIGHTING_TUB_ID = "competition-safety-lighting-tub";
export const COMPETITION_HIKING_WEATHER_TUB_ID = "competition-hiking-weather-tub";
export const COMPETITION_CYCLING_REPAIRS_TUB_ID = "competition-cycling-repairs-tub";

export const COMPETITION_SLEEPING_BAG_ID = "competition-sleeping-bag";
export const COMPETITION_SLEEPING_PAD_ID = "competition-sleeping-pad";
export const COMPETITION_UPGRADE_PREFERENCES_ID = "competition-upgrade-preferences";
export const COMPETITION_FAMILY_PREFERENCES_ID = COMPETITION_UPGRADE_PREFERENCES_ID;
export const COMPETITION_PREVIOUS_TRIP_EXPERIENCES_ID = "competition-previous-trip-experiences";
export const COMPETITION_FOUR_DAY_FAMILY_TRIP_ID = "competition-four-day-family-trip";
export const COMPETITION_NEXT_TRIP_PACKING_PLAN_ID = "competition-next-trip-packing-plan";
export const COMPETITION_UPGRADE_PLAN_ID = "competition-upgrade-plan";
export const COMPETITION_NEXT_YEAR_UPGRADE_PLAN_ID = COMPETITION_UPGRADE_PLAN_ID;

// Existing opaque record identities survive the physical-model migration.
export const COMPETITION_BASEMENT_ID = COMPETITION_CAMPING_KIT_ID;
export const COMPETITION_STORAGE_WALL_ID = COMPETITION_BASEMENT_GEAR_STORAGE_ID;
export const COMPETITION_MUDROOM_ID = COMPETITION_FAMILY_PREFERENCES_ID;
export const COMPETITION_GARAGE_ID = COMPETITION_PREVIOUS_TRIP_EXPERIENCES_ID;
export const COMPETITION_SHOE_BENCH_ID = COMPETITION_FOUR_DAY_FAMILY_TRIP_ID;
export const COMPETITION_BIKE_RACK_ID = COMPETITION_NEXT_TRIP_PACKING_PLAN_ID;
export const COMPETITION_PAD_REPAIR_POUCH_ID = COMPETITION_UPGRADE_PLAN_ID;
export const COMPETITION_UPGRADE_TARGET_LIFE_LINK_ID = COMPETITION_SLEEPING_PAD_ID;
export const COMPETITION_CAMPING_COLLECTION_ID = "collection-00000000-0000-4000-8000-000000000001";
export const COMPETITION_CAMPING_COLLECTION_TITLE = "Camping Gear";
export const COMPETITION_SECTION_IDS = {
  familySleepSystems: "section-00000000-0000-4000-8000-000000000001",
  shelter: "section-00000000-0000-4000-8000-000000000002",
  campKitchen: "section-00000000-0000-4000-8000-000000000003",
  cyclingKit: "section-00000000-0000-4000-8000-000000000004",
  nextYearUpgrades: "section-00000000-0000-4000-8000-000000000005"
} as const;

export const COMPETITION_START_LIFE_LINK_ID = COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_ID;
export const COMPETITION_FIND_TARGET_LIFE_LINK_ID = COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_ID;
export const COMPETITION_FIND_DECOY_LIFE_LINK_ID = COMPETITION_SHELTER_TUB_ID;

export const COMPETITION_FAMILY_ADVENTURE_GEAR_TITLE = "Basement";
export const COMPETITION_BASEMENT_GEAR_STORAGE_TITLE = "Storage wall";
export const COMPETITION_SHELTER_TUB_TITLE = "Blue Tub 01 / Shelter";
export const COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_TITLE = "Green Tub 02 / Family Sleep Systems";
export const COMPETITION_KITCHEN_WATER_TUB_TITLE = "Gray Tub 03 / Kitchen and Water";
export const COMPETITION_SAFETY_LIGHTING_TUB_TITLE = "Red Tub 04 / Safety and Lighting";
export const COMPETITION_HIKING_WEATHER_TUB_TITLE = "Yellow Tub 05 / Hiking and Weather";
export const COMPETITION_CYCLING_REPAIRS_TUB_TITLE = "Black Tub 06 / Cycling and Repairs";
export const COMPETITION_FAMILY_PREFERENCES_TITLE = "Mudroom";
export const COMPETITION_PREVIOUS_TRIP_EXPERIENCES_TITLE = "Garage";
export const COMPETITION_FOUR_DAY_FAMILY_TRIP_TITLE = "Shoe bench";
export const COMPETITION_NEXT_TRIP_PACKING_PLAN_TITLE = "Bike rack";
export const COMPETITION_NEXT_YEAR_UPGRADE_PLAN_TITLE = "Sleeping Pad Repair Pouch";
export const COMPETITION_SLEEPING_BAG_TITLE = "Camping Sleeping Bag";
export const COMPETITION_SLEEPING_PAD_TITLE = "Camping Sleeping Pad";
export const COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_PUBLIC_BODY =
  "Recorded current: sleep systems for two adults and two children; return all labeled sets here after trips.";

export const COMPETITION_INITIAL_UPGRADE_PLAN_BODY =
  "Planned: No next-year family gear upgrade priority has been selected. Nothing has been purchased, owned, or installed.";

export const COMPETITION_RECOMMENDED_UPGRADE_PLAN_BODY = [
  "Planned upgrade priority: sleeping pad.",
  "",
  "Reason: The current low-R pad caused cold through the ground, while the existing sleeping bag kept me warm around 35°F and still works.",
  "",
  "Requirements: prioritize warmth over minimum weight; stay within the $250 budget; keep the working sleeping bag.",
  "",
  "Status: planned only — not purchased, owned, or installed."
].join("\n");

export const COMPETITION_LIFE_LINK_IDS = {
  familyAdventureGear: COMPETITION_FAMILY_ADVENTURE_GEAR_ID,
  basementGearStorage: COMPETITION_BASEMENT_GEAR_STORAGE_ID,
  shelterTub: COMPETITION_SHELTER_TUB_ID,
  familySleepSystemsTub: COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_ID,
  kitchenWaterTub: COMPETITION_KITCHEN_WATER_TUB_ID,
  safetyLightingTub: COMPETITION_SAFETY_LIGHTING_TUB_ID,
  hikingWeatherTub: COMPETITION_HIKING_WEATHER_TUB_ID,
  cyclingRepairsTub: COMPETITION_CYCLING_REPAIRS_TUB_ID,
  familyPreferences: COMPETITION_FAMILY_PREFERENCES_ID,
  previousTripExperiences: COMPETITION_PREVIOUS_TRIP_EXPERIENCES_ID,
  fourDayFamilyTrip: COMPETITION_FOUR_DAY_FAMILY_TRIP_ID,
  nextTripPackingPlan: COMPETITION_NEXT_TRIP_PACKING_PLAN_ID,
  nextYearUpgradePlan: COMPETITION_NEXT_YEAR_UPGRADE_PLAN_ID,
  adultOneSleepSystem: "competition-adult-one-sleep-system",
  adultOneSleepingBag: "competition-adult-one-sleeping-bag",
  adultOneSleepingPad: "competition-adult-one-sleeping-pad",
  adultTwoSleepSystem: "competition-adult-two-sleep-system",
  sleepingBag: COMPETITION_SLEEPING_BAG_ID,
  sleepingPad: COMPETITION_SLEEPING_PAD_ID,
  kidsSleepGear: "competition-kids-sleep-gear",
  childOneSleepingBag: "competition-child-one-sleeping-bag",
  childOneSleepingPad: "competition-child-one-sleeping-pad",
  childTwoSleepingBag: "competition-child-two-sleeping-bag",
  childTwoSleepingPad: "competition-child-two-sleeping-pad",
  familyPillowsLiners: "competition-family-pillows-liners",
  familyTent: "competition-family-tent",
  tentPoleBag: "competition-tent-pole-bag",
  tentStakeKit: "competition-tent-stake-kit",
  footprintRainfly: "competition-footprint-rainfly",
  screenShelter: "competition-screen-shelter",
  campsiteGroundTarp: "competition-campsite-ground-tarp",
  shelterRepairKit: "competition-shelter-repair-kit",
  campKitchenCrate: "competition-camp-kitchen-crate",
  twoBurnerStove: "competition-two-burner-stove",
  cooksetMessKit: "competition-cookset-mess-kit",
  waterSystem: "competition-water-system",
  waterCube: "competition-water-cube",
  familyWaterFilter: "competition-family-water-filter",
  coolerIcePacks: "competition-cooler-ice-packs",
  familyFirstAidKit: "competition-family-first-aid-kit",
  adultMedicationsPouch: "competition-adult-medications-pouch",
  kidsCarePouch: "competition-kids-care-pouch",
  lightingKit: "competition-lighting-kit",
  fourHeadlamps: "competition-four-headlamps",
  lanternsBatteries: "competition-lanterns-batteries",
  emergencyVisibilityKit: "competition-emergency-visibility-kit",
  dayHikePacks: "competition-day-hike-packs",
  adultDaypacks: "competition-adult-daypacks",
  childDaypacks: "competition-child-daypacks",
  weatherLayers: "competition-weather-layers",
  adultRainShells: "competition-adult-rain-shells",
  kidsShellsMidlayers: "competition-kids-shells-midlayers",
  trailNavigationKit: "competition-trail-navigation-kit",
  familyCyclingGear: "competition-family-cycling-gear",
  adultHelmets: "competition-adult-helmets",
  kidsHelmets: "competition-kids-helmets",
  childBikeLights: "competition-child-bike-lights",
  bikeRepairKit: "competition-bike-repair-kit",
  miniPumpPatchKit: "competition-mini-pump-patch-kit",
  multiToolSpareTubes: "competition-multi-tool-spare-tubes"
} as const;

export const COMPETITION_LIFE_LINK_COUNT = Object.keys(COMPETITION_LIFE_LINK_IDS).length;
export const COMPETITION_QR_COUNT = COMPETITION_QR_IDS.length;

export type CompetitionFixtureData = {
  profile: typeof COMPETITION_FIXTURE_PROFILE;
  owner: UserRecord;
  batch: ExportBatchRecord;
  qrInventory: QrInventoryRecord[];
  lifeLinks: LifeLinkRecord[];
  qrBindings: LifeLinkQrBindingRecord[];
  collections: CollectionRecord[];
  collectionSections: CollectionSectionRecord[];
  collectionMemberships: CollectionMembershipRecord[];
  collectionSectionAssignments: CollectionSectionAssignmentRecord[];
};

type FixtureLifeLinkDefinition = {
  id: string;
  parentId: string | null;
  qrId?: string;
  title: string;
  body: string;
  privacy: LifeLinkRecord["privacy"];
};

const id = COMPETITION_LIFE_LINK_IDS;

const COMPETITION_LIFE_LINK_DEFINITIONS: readonly FixtureLifeLinkDefinition[] = [
  definition(
    id.familyAdventureGear,
    null,
    COMPETITION_FAMILY_ADVENTURE_GEAR_TITLE,
    "Basement below the family home. Adventure equipment is stored on the west storage wall."
  ),
  definition(
    id.basementGearStorage,
    id.familyAdventureGear,
    COMPETITION_BASEMENT_GEAR_STORAGE_TITLE,
    "Recorded placement: six labeled adventure tubs are kept on the west basement rack; tents dry before storage and bike gear returns here after each trip."
  ),
  definition(
    id.shelterTub,
    id.basementGearStorage,
    COMPETITION_SHELTER_TUB_TITLE,
    "Recorded current: shelter, ground protection, staking tools, and field repairs for the family campsite.",
    { qrId: COMPETITION_SHELTER_TUB_QR_ID }
  ),
  definition(
    id.familySleepSystemsTub,
    id.basementGearStorage,
    COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_TITLE,
    COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_PUBLIC_BODY,
    { qrId: COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_QR_ID, privacy: "public" }
  ),
  definition(
    id.kitchenWaterTub,
    id.basementGearStorage,
    COMPETITION_KITCHEN_WATER_TUB_TITLE,
    "Recorded current: four-person cooking, eating, water storage, filtration, and cooler equipment.",
    { qrId: COMPETITION_KITCHEN_WATER_TUB_QR_ID }
  ),
  definition(
    id.safetyLightingTub,
    id.basementGearStorage,
    COMPETITION_SAFETY_LIGHTING_TUB_TITLE,
    "Recorded current: first aid, family-specific care, lighting, batteries, whistles, and reflective gear.",
    { qrId: COMPETITION_SAFETY_LIGHTING_TUB_QR_ID }
  ),
  definition(
    id.hikingWeatherTub,
    id.basementGearStorage,
    COMPETITION_HIKING_WEATHER_TUB_TITLE,
    "Recorded current: four day-hike packs, rain protection, warm layers, and trail navigation.",
    { qrId: COMPETITION_HIKING_WEATHER_TUB_QR_ID }
  ),
  definition(
    id.cyclingRepairsTub,
    id.basementGearStorage,
    COMPETITION_CYCLING_REPAIRS_TUB_TITLE,
    "Recorded current: four helmets, child bike lights, and trail-side repair supplies.",
    { qrId: COMPETITION_CYCLING_REPAIRS_TUB_QR_ID }
  ),
  definition(
    id.familyPreferences,
    null,
    COMPETITION_FAMILY_PREFERENCES_TITLE,
    "Entry room beside the back door; shoes dry on the bench before returning to storage."
  ),
  definition(
    id.previousTripExperiences,
    null,
    COMPETITION_PREVIOUS_TRIP_EXPERIENCES_TITLE,
    "Detached garage with a wall-mounted bicycle rack."
  ),
  definition(
    id.fourDayFamilyTrip,
    id.familyPreferences,
    COMPETITION_FOUR_DAY_FAMILY_TRIP_TITLE,
    "Wooden shoe bench in the mudroom; the lower shelf is empty after the last cleanup."
  ),
  definition(
    id.nextTripPackingPlan,
    id.previousTripExperiences,
    COMPETITION_NEXT_TRIP_PACKING_PLAN_TITLE,
    "Four-position wall rack in the garage; hooks and wall fasteners were checked."
  ),
  definition(
    id.nextYearUpgradePlan,
    id.familySleepSystemsTub,
    COMPETITION_NEXT_YEAR_UPGRADE_PLAN_TITLE,
    "Small zip pouch containing the current sleeping pad's valve tool, repair patches, and adhesive. No replacement pad has been purchased."
  ),
  definition(
    id.adultOneSleepSystem,
    id.familySleepSystemsTub,
    "Adult One Sleep Bag",
    "Recorded configuration: Adult One uses the 20°F bag and insulated R-4.2 pad stored beneath this Life Link."
  ),
  definition(
    id.adultOneSleepingBag,
    id.adultOneSleepSystem,
    "Adult One Sleeping Bag",
    "Recorded current: 20°F adult bag is clean, dry, and ready for the next trip."
  ),
  definition(
    id.adultOneSleepingPad,
    id.adultOneSleepSystem,
    "Adult One Sleeping Pad",
    "Recorded current: insulated R-4.2 pad held air overnight during the latest home test."
  ),
  definition(
    id.adultTwoSleepSystem,
    id.familySleepSystemsTub,
    "Adult Two Sleep Bag",
    "Recorded configuration: Adult Two uses the existing Camping Sleeping Bag and Camping Sleeping Pad; their prior-trip results drive the upgrade decision."
  ),
  definition(
    id.sleepingBag,
    id.adultTwoSleepSystem,
    COMPETITION_SLEEPING_BAG_TITLE,
    "Recorded current: This working sleeping bag kept me warm around 35°F. Owner does not want to replace gear that works.",
    { qrId: COMPETITION_SLEEPING_BAG_QR_ID, privacy: "public" }
  ),
  definition(
    id.sleepingPad,
    id.adultTwoSleepSystem,
    COMPETITION_SLEEPING_PAD_TITLE,
    "Owner report: Cold came through the ground on the last trip. Recorded current: low-R sleeping pad.",
    { qrId: COMPETITION_SLEEPING_PAD_QR_ID }
  ),
  definition(
    id.kidsSleepGear,
    id.familySleepSystemsTub,
    "Kids Sleep Duffel",
    "Recorded configuration: separate labeled bag and pad sets for Child One, age 10, and Child Two, age 7."
  ),
  definition(
    id.childOneSleepingBag,
    id.kidsSleepGear,
    "Child One Sleeping Bag",
    "Recorded current: youth 30°F bag fits the 10-year-old with room for one warm layer."
  ),
  definition(
    id.childOneSleepingPad,
    id.kidsSleepGear,
    "Child One Sleeping Pad",
    "Recorded current: insulated youth pad held air overnight during the latest home test."
  ),
  definition(
    id.childTwoSleepingBag,
    id.kidsSleepGear,
    "Child Two Sleeping Bag",
    "Recorded current: youth 30°F bag fits the 7-year-old; zipper pull has a reflective cord."
  ),
  definition(
    id.childTwoSleepingPad,
    id.kidsSleepGear,
    "Child Two Sleeping Pad",
    "Recorded current: insulated youth pad is marked blue and held air overnight during the latest test."
  ),
  definition(
    id.familyPillowsLiners,
    id.familySleepSystemsTub,
    "Pillow and Liner Bag",
    "Recorded current: four compressible pillows and four washable liners are labeled by family member."
  ),
  definition(
    id.familyTent,
    id.shelterTub,
    "Family Tent",
    "Recorded current: six-person tent fits two adults and two children; fabric and zippers passed the spring setup check."
  ),
  definition(
    id.tentPoleBag,
    id.familyTent,
    "Tent Pole Bag",
    "Recorded current: complete color-coded pole set; shock cord is firm and all hubs are present."
  ),
  definition(
    id.tentStakeKit,
    id.familyTent,
    "Tent Stake Kit",
    "Recorded current: sixteen stakes, four guylines, a rubber mallet, and an orange stake puller are present."
  ),
  definition(
    id.footprintRainfly,
    id.familyTent,
    "Tent Footprint and Rainfly",
    "Recorded current: footprint is patched and dry; rainfly was seam-checked after the last wet trip."
  ),
  definition(
    id.screenShelter,
    id.shelterTub,
    "Screen Shelter",
    "Recorded current: dining shelter seats four and keeps insects out; stored with dedicated corner stakes."
  ),
  definition(
    id.campsiteGroundTarp,
    id.shelterTub,
    "Campsite Ground Tarp",
    "Recorded current: 8-by-10-foot tarp covers muddy sites or a bike-repair area."
  ),
  definition(
    id.shelterRepairKit,
    id.shelterTub,
    "Shelter Repair Kit",
    "Recorded current: seam sealer, pole sleeve, fabric patches, cord, and spare zipper pulls."
  ),
  definition(
    id.campKitchenCrate,
    id.kitchenWaterTub,
    "Camp Kitchen Crate",
    "Recorded configuration: stove and combined four-person cook-and-eat kit stay together for one-step loading."
  ),
  definition(
    id.twoBurnerStove,
    id.campKitchenCrate,
    "Two-Burner Camp Stove",
    "Recorded current: both burners ignite; pack two one-pound propane canisters for a four-day trip."
  ),
  definition(
    id.cooksetMessKit,
    id.campKitchenCrate,
    "Family Cookset and Four-Person Mess Kit",
    "Recorded current: pots, skillet, four color-coded plates, bowls, mugs, and utensil sets are complete."
  ),
  definition(
    id.waterSystem,
    id.kitchenWaterTub,
    "Water Gear Crate",
    "Recorded configuration: bulk water, filtration, and cooler storage support four people at camp and on hikes."
  ),
  definition(
    id.waterCube,
    id.waterSystem,
    "20-Liter Water Cube",
    "Recorded current: cap seal is sound; sanitize and fill at home when campsite water status is uncertain."
  ),
  definition(
    id.familyWaterFilter,
    id.waterSystem,
    "Family Water Filter",
    "Recorded current: gravity filter was backflushed after the last trip; clean-water bag is labeled."
  ),
  definition(
    id.coolerIcePacks,
    id.waterSystem,
    "Family Cooler and Ice Packs",
    "Recorded current: 45-quart cooler fits four days of family food; freeze all four flat ice packs before departure."
  ),
  definition(
    id.familyFirstAidKit,
    id.safetyLightingTub,
    "Family First Aid Kit",
    "Recorded current: core first-aid supplies cover four people; inventory was checked after the last hike."
  ),
  definition(
    id.adultMedicationsPouch,
    id.familyFirstAidKit,
    "Adult Medications Pouch",
    "Recorded configuration: synthetic demo pouch for two adults; verify trip-specific items before packing."
  ),
  definition(
    id.kidsCarePouch,
    id.familyFirstAidKit,
    "Kids Care Pouch",
    "Recorded current: child-size bandages, blister care, tick tool, and two emergency contact cards."
  ),
  definition(
    id.lightingKit,
    id.safetyLightingTub,
    "Family Lighting Kit",
    "Recorded configuration: one headlamp per person plus two lanterns and labeled spare batteries."
  ),
  definition(
    id.fourHeadlamps,
    id.lightingKit,
    "Four Headlamps",
    "Recorded current: two adult and two child headlamps work; child straps are pre-sized."
  ),
  definition(
    id.lanternsBatteries,
    id.lightingKit,
    "Two Camp Lanterns and Spare Batteries",
    "Recorded current: table and tent lanterns pass the low-power test; sealed AA and AAA spares are labeled."
  ),
  definition(
    id.emergencyVisibilityKit,
    id.safetyLightingTub,
    "Emergency Whistles and Reflective Bands",
    "Recorded current: four whistles and four reflective wrist bands, one matching set per family member."
  ),
  definition(
    id.dayHikePacks,
    id.hikingWeatherTub,
    "Hiking Pack Duffel",
    "Recorded configuration: two adult and two child packs are fitted and color-coded for family hikes."
  ),
  definition(
    id.adultDaypacks,
    id.dayHikePacks,
    "Adult Daypacks",
    "Recorded current: two 20-liter packs fit the adults and carry water, navigation, and shared layers."
  ),
  definition(
    id.childDaypacks,
    id.dayHikePacks,
    "Child Daypacks",
    "Recorded current: 10-liter and 8-liter packs fit the children; keep loads under their comfort limits."
  ),
  definition(
    id.weatherLayers,
    id.hikingWeatherTub,
    "Weather Clothing Bag",
    "Recorded configuration: rain shells and warm midlayers are grouped by adult and child sizes."
  ),
  definition(
    id.adultRainShells,
    id.weatherLayers,
    "Adult Rain Shells",
    "Recorded current: two waterproof shells fit; renew water repellency before sustained rain."
  ),
  definition(
    id.kidsShellsMidlayers,
    id.weatherLayers,
    "Kids Rain Shells and Warm Midlayers",
    "Recorded current: size 10 and size 7 shells fit over two labeled fleece layers."
  ),
  definition(
    id.trailNavigationKit,
    id.hikingWeatherTub,
    "Trail Maps and Compass",
    "Recorded current: baseplate compass, waterproof map case, and synthetic state-park map support the planned hikes."
  ),
  definition(
    id.familyCyclingGear,
    id.cyclingRepairsTub,
    "Helmet and Light Bag",
    "Recorded configuration: helmet and visibility gear supports two adult and two child bikes on campground paths."
  ),
  definition(
    id.adultHelmets,
    id.familyCyclingGear,
    "Adult Bike Helmets",
    "Recorded current: two adult helmets fit and show no impact damage."
  ),
  definition(
    id.kidsHelmets,
    id.familyCyclingGear,
    "Kids Bike Helmets",
    "Recorded current: two child helmets fit after the latest adjustment; recheck before each trip."
  ),
  definition(
    id.childBikeLights,
    id.familyCyclingGear,
    "Child Bike Lights",
    "Previous issue: mounts loosened on rough paths. Recorded current: both mounts were retightened; verify at packing."
  ),
  definition(
    id.bikeRepairKit,
    id.cyclingRepairsTub,
    "Bike Repair Kit",
    "Recorded configuration: inflation, patching, multi-tool, and family bike tube sizes stay in one trail-side pouch."
  ),
  definition(
    id.miniPumpPatchKit,
    id.bikeRepairKit,
    "Mini Pump and Patch Kit",
    "Recorded current: pump supports both valve types; glue-free patches and tire levers are complete."
  ),
  definition(
    id.multiToolSpareTubes,
    id.bikeRepairKit,
    "Multi-Tool and Spare Tubes",
    "Recorded current: hex multi-tool plus one adult and two child-size spare tubes match the family bikes."
  )
];

export const COMPETITION_SECTION_MEMBER_IDS = {
  familySleepSystems: [id.adultOneSleepSystem, id.adultOneSleepingBag, id.adultOneSleepingPad,
    id.adultTwoSleepSystem, id.sleepingBag, id.sleepingPad, id.kidsSleepGear,
    id.childOneSleepingBag, id.childOneSleepingPad, id.childTwoSleepingBag,
    id.childTwoSleepingPad, id.familyPillowsLiners, id.nextYearUpgradePlan],
  shelter: [id.familyTent, id.tentPoleBag, id.tentStakeKit, id.footprintRainfly,
    id.screenShelter, id.campsiteGroundTarp, id.shelterRepairKit, id.dayHikePacks,
    id.adultDaypacks, id.childDaypacks, id.weatherLayers, id.adultRainShells,
    id.kidsShellsMidlayers, id.trailNavigationKit],
  campKitchen: [id.campKitchenCrate, id.twoBurnerStove, id.cooksetMessKit, id.waterSystem,
    id.waterCube, id.familyWaterFilter, id.coolerIcePacks, id.familyFirstAidKit,
    id.adultMedicationsPouch, id.kidsCarePouch, id.lightingKit, id.fourHeadlamps,
    id.lanternsBatteries, id.emergencyVisibilityKit],
  cyclingKit: [id.familyCyclingGear, id.adultHelmets, id.kidsHelmets, id.childBikeLights,
    id.bikeRepairKit, id.miniPumpPatchKit, id.multiToolSpareTubes],
  nextYearUpgrades: [id.sleepingPad, id.childBikeLights, id.adultRainShells, id.nextYearUpgradePlan]
} as const;

export const COMPETITION_CAMPING_MEMBER_IDS = [
  ...COMPETITION_SECTION_MEMBER_IDS.familySleepSystems,
  ...COMPETITION_SECTION_MEMBER_IDS.shelter,
  ...COMPETITION_SECTION_MEMBER_IDS.campKitchen,
  ...COMPETITION_SECTION_MEMBER_IDS.cyclingKit
] as const;

const SECTION_TITLES: Record<keyof typeof COMPETITION_SECTION_IDS, string> = {
  familySleepSystems: "Family sleep systems", shelter: "Shelter", campKitchen: "Camp kitchen",
  cyclingKit: "Cycling kit", nextYearUpgrades: "Next-year upgrades"
};

export const COMPETITION_COLLECTION_PURPOSE =
  "Equipment for two adults and two children on a four-day camping trip with day hikes and family cycling.";
export const COMPETITION_COLLECTION_NOTES = [
  "Family fit: two adults, one 10-year-old, and one 7-year-old. Gear is stored across six tubs on the basement storage wall.",
  "Owner preference: warmth matters more than minimum weight. Budget for the next camping upgrade: $250. Do not replace working gear.",
  "Owner report: the last four-day trip reached about 35°F, included a three-mile hike and campground cycling. The sleeping bag stayed warm; cold came through the low-R sleeping pad. Child bike-light mounts loosened on rough ground.",
  "Next trip, planned only: four days of camping, two day hikes, and family cycling. Check four helmets and lights, rain shells, and first aid. The replacement sleeping pad is not purchased, owned, or installed."
].join("\n\n");

const FIXTURE_CONTEXT: Record<string, LifeLinkContext> = {
  [id.familySleepSystemsTub]: {
    schemaVersion: 1,
    summary: { text: COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_PUBLIC_BODY, truthState: "owner_reported" },
    condition: { text: "The sleeping bag works. The low-R sleeping pad needs a warmth review before next year.", truthState: "owner_reported" }
  },
  [id.sleepingBag]: {
    schemaVersion: 1,
    condition: { text: "Clean, dry, and working.", truthState: "owner_reported" },
    experience: { text: "This sleeping bag kept me warm around 35°F on the four-day family trip.", truthState: "owner_reported" },
    plan: { text: "Keep the working sleeping bag. Do not replace gear that works.", truthState: "planned" }
  },
  [id.sleepingPad]: {
    schemaVersion: 1,
    condition: { text: "Current low-R sleeping pad; no replacement is owned.", truthState: "owner_reported" },
    experience: { text: "Cold came through the ground on the last trip, while the existing sleeping bag stayed warm around 35°F.", truthState: "owner_reported" },
    summary: { text: "Prioritize warmth over minimum weight, keep the working sleeping bag, and stay within the $250 upgrade budget.", truthState: "owner_reported" },
    plan: { text: COMPETITION_INITIAL_UPGRADE_PLAN_BODY, truthState: "planned" }
  },
  [id.childBikeLights]: {
    schemaVersion: 1,
    experience: { text: "The mounts loosened on rough campground paths during the previous trip.", truthState: "owner_reported" },
    condition: { text: "Both mounts have been retightened; the existing lights work.", truthState: "owner_reported" },
    plan: { text: "Recheck the existing mounts before next year's family cycling. No replacement lights are planned or purchased.", truthState: "planned" }
  },
  [id.adultRainShells]: {
    schemaVersion: 1,
    condition: { text: "Both existing rain shells fit.", truthState: "owner_reported" },
    plan: { text: "Renew water repellency before next year's wet hikes; keep the existing shells.", truthState: "planned" }
  },
  [id.nextYearUpgradePlan]: {
    schemaVersion: 1,
    condition: { text: "The existing pad repair pouch contains a valve tool, patches, and adhesive.", truthState: "owner_reported" },
    plan: { text: "Check repair-patch compatibility when choosing next year's sleeping pad. A replacement pad is planned only, not purchased, owned, or installed.", truthState: "planned" }
  }
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
    count: COMPETITION_QR_COUNT,
    createdBy: owner.id,
    createdAt: timestamp
  };
  const qrInventory: QrInventoryRecord[] = COMPETITION_QR_IDS.map((qrId) => ({
    id: qrId,
    url: `${cleanQrBaseUrl}/qr/${encodeURIComponent(qrId)}`,
    batchId: batch.id,
    createdAt: timestamp
  }));
  const lifeLinks = COMPETITION_LIFE_LINK_DEFINITIONS.map((item) =>
    materializeLifeLink(item, owner.id, timestamp)
  );
  const qrBindings: LifeLinkQrBindingRecord[] = [
    binding(COMPETITION_SLEEPING_BAG_QR_ID, id.sleepingBag),
    binding(COMPETITION_SLEEPING_PAD_QR_ID, id.sleepingPad),
    binding(COMPETITION_SHELTER_TUB_QR_ID, id.shelterTub),
    binding(COMPETITION_FAMILY_SLEEP_SYSTEMS_TUB_QR_ID, id.familySleepSystemsTub),
    binding(COMPETITION_KITCHEN_WATER_TUB_QR_ID, id.kitchenWaterTub),
    binding(COMPETITION_SAFETY_LIGHTING_TUB_QR_ID, id.safetyLightingTub),
    binding(COMPETITION_HIKING_WEATHER_TUB_QR_ID, id.hikingWeatherTub),
    binding(COMPETITION_CYCLING_REPAIRS_TUB_QR_ID, id.cyclingRepairsTub)
  ];
  const collection: CollectionRecord = {
    id: COMPETITION_CAMPING_COLLECTION_ID, ownerId: owner.id,
    title: COMPETITION_CAMPING_COLLECTION_TITLE, purpose: COMPETITION_COLLECTION_PURPOSE,
    notes: COMPETITION_COLLECTION_NOTES, createdAt: timestamp, updatedAt: timestamp
  };
  const collectionSections: CollectionSectionRecord[] = Object.entries(COMPETITION_SECTION_IDS).map(([key, sectionId], position) => ({
    id: sectionId, ownerId: owner.id, collectionId: collection.id,
    title: SECTION_TITLES[key as keyof typeof SECTION_TITLES], position, createdAt: timestamp, updatedAt: timestamp
  }));
  const collectionMemberships = COMPETITION_CAMPING_MEMBER_IDS.map((lifeLinkId) => ({
    ownerId: owner.id, collectionId: collection.id, lifeLinkId, createdAt: timestamp
  }));
  const collectionSectionAssignments = Object.entries(COMPETITION_SECTION_MEMBER_IDS).flatMap(([key, memberIds]) =>
    memberIds.map((lifeLinkId) => ({ ownerId: owner.id, collectionId: collection.id, lifeLinkId,
      sectionId: COMPETITION_SECTION_IDS[key as keyof typeof COMPETITION_SECTION_IDS], createdAt: timestamp }))
  );
  return {
    profile: COMPETITION_FIXTURE_PROFILE,
    owner,
    batch,
    qrInventory,
    lifeLinks,
    qrBindings,
    collections: [collection], collectionSections, collectionMemberships, collectionSectionAssignments
  };

  function binding(qrId: string, lifeLinkId: string): LifeLinkQrBindingRecord {
    return { qrId, lifeLinkId, boundAt: timestamp };
  }
}

function definition(
  lifeLinkId: string,
  parentId: string | null,
  title: string,
  body: string,
  options: { qrId?: string; privacy?: LifeLinkRecord["privacy"] } = {}
): FixtureLifeLinkDefinition {
  return {
    id: lifeLinkId,
    parentId,
    qrId: options.qrId,
    title,
    body,
    privacy: options.privacy ?? "private"
  };
}

function materializeLifeLink(
  item: FixtureLifeLinkDefinition,
  ownerId: string,
  timestamp: string
): LifeLinkRecord {
  return {
    id: item.id,
    ownerId,
    parentId: item.parentId,
    qrId: item.qrId ?? null,
    title: item.title,
    body: item.body,
    bodyDoc: plainBodyDoc(item.body),
    bodyDocVersion: 1,
    privacy: item.privacy,
    browsingRole: item.id === id.fourDayFamilyTrip || item.id === id.nextTripPackingPlan ||
      COMPETITION_LIFE_LINK_DEFINITIONS.some((child) => child.parentId === item.id) ? "container" : "item",
    context: structuredClone(FIXTURE_CONTEXT[item.id] ?? { schemaVersion: 1 }),
    placementConfirmedAt: item.parentId ? timestamp : null,
    publicFieldKeys: item.id === id.familySleepSystemsTub ? ["summary"] : item.id === id.sleepingBag ? ["condition"] : [],
    media: [],
    createdAt: timestamp,
    updatedAt: timestamp
  };
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
