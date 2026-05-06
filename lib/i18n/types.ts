export type Locale = "en" | "zh";

export const LOCALES: Locale[] = ["en", "zh"];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "locale";

export interface Dictionary {
  metadata: {
    title: string;
    titleTemplate: string;
    description: string;
  };
  nav: {
    sanctuary: string;
    apocrypha: string;
    requiem: string;
    vigils: string;
  };
  hero: {
    manifesto: string;
    oracleTitle: string;
    originBody: string;
    codename: string;
    portraitAlt: string;
    descent: {
      heading: string;
      subheading: string;
      prophecy: string;
      adventDate: string;
      years: string;
      months: string;
      days: string;
    };
  };
  oracleVideos: {
    beginOffering: string;
    enterTemple: string;
  };
  sections: {
    writtenWordTitle: string;
    writtenWordVolume: string;
    openArchives: string;
    visualWitnessTitle: string;
    visualWitnessGallery: string;
    enterFrame: string;
    sacredArtifact: string;
    relicCollectionTitle: string;
    agentControlTitle: string;
    syntheticHallucinations: string;
    neuralSync: string;
  };
  footer: {
    copyright: string;
    sacredTerms: string;
    privacyCovenant: string;
  };
  langSwitch: {
    aria: string;
    en: string;
    zh: string;
  };
  auth: {
    sanctumEntrance: string;
    pageTitle: string;
    descBefore: string;
    descTokenName: string;
    descMiddle: string;
    descDiva: string;
    descSeparator: string;
    descGoddess: string;
    descAfter: string;
    tokenPlaceholder: string;
    enterSanctuary: string;
    pending: string;
    invalidToken: string;
  };
  userMenu: {
    aria: string;
    memberReview: string;
    logOut: string;
  };
  tier: {
    highLord: string;
    priestess: string; // {{level}}
    acolyte: string; // {{level}}
  };
  gender: {
    female: string;
    male: string;
    other: string;
    none: string;
  };
  profile: {
    vesselIdentity: string;
    innerRecord: string;
    backToSanctuary: string;
    vesselBasics: string;
    fieldName: string;
    fieldGender: string;
    fieldTier: string;
    sigil: string;
    mosaicAwakening: string;
    mosaicDescription: string;
    aptitudesPentagram: string;
    stewardedByHighLord: string;
    specialAttributes: string;
    noneInscribed: string;
    aptitudesHelp: string;
    footerNote: string;
  };
  bio: {
    autobiography: string;
    revise: string;
    inscribe: string;
    emptyState: string;
    placeholder: string;
    counter: string; // {{count}}
    saveFailed: string;
    seal: string;
    pending: string;
    withdraw: string;
  };
  activity: {
    currentDispatches: string;
    aiPolish: string;
    placeholder: string;
    log: string;
    pending: string;
    failed: string;
    emptyState: string;
    remove: string;
  };
  token: {
    label: string;
    hideAria: string;
    showAria: string;
    hideTitle: string;
    showTitle: string;
  };
  skills: {
    attack: string;
    defense: string;
    hp: string;
    agility: string;
    luck: string;
    radarAria: string;
  };
  adminUsers: {
    rosterAcolytes: string;
    disciples: string;
    anoint: string;
    backToSanctuary: string;
    you: string;
    colRecord: string;
    colName: string;
    colGender: string;
    colLevel: string;
    colToken: string;
    colJoined: string;
    edit: string;
    remove: string;
    priestessShort: string; // {{level}}
    acolyteShort: string; // {{level}}
    confirmRemove: string; // {{name}}
    deleteFailed: string; // {{error}}
    prevPage: string;
    nextPage: string;
    pageInfo: string; // {{page}} {{total}}
    totalCount: string; // {{count}}
  };
  adminUserForm: {
    newAcolyteLabel: string;
    newAcolyteTitle: string;
    amendAcolyteLabel: string;
    amendAcolyteTitle: string;
    fieldName: string;
    fieldGender: string;
    fieldGenderEmpty: string;
    fieldLevel: string;
    fieldAvatar: string;
    avatarPlaceholder: string;
    tokenLabel: string;
    regenerate: string;
    submitAnoint: string;
    submitSave: string;
    cancel: string;
    sacredTokenIssued: string;
    bearCarefully: string;
    revealOnceNotice: string; // {{name}}
    copy: string;
    copied: string;
    done: string;
    confirmRotate: string;
    rotateFailed: string; // {{error}}
  };
  errors: {
    invalidRequest: string;
    invalidToken: string;
    cannotDemoteOnlyPriestess: string;
    cannotRemoveSelf: string;
    cannotRemoveOnlyPriestess: string;
  };
  relicCollection: {
    pageTitle: string;
    subtitle: string;
    capacity: string; // {{filled}} {{total}}
    statusGuest: string;
    statusInitiate: string;
    statusHighLord: string;
    sidebarTitle: string;
    filterAll: string;
    filterCommon: string;
    filterRare: string;
    filterEpic: string;
    filterLegendary: string;
    filterSpecialItem: string;
    cellEmpty: string;
    cellSlot: string; // {{slot}}
    backToVault: string;
    rarityCommon: string;
    rarityRare: string;
    rarityEpic: string;
    rarityLegendary: string;
    raritySpecialItem: string;
    needLevelTitle: string;
    needLevelBody: string; // {{required}}
    needPasswordTitle: string;
    needPasswordBody: string;
    passwordPlaceholder: string;
    unlock: string;
    unlocking: string;
    unlockFailed: string;
    rateLimited: string;
    cancel: string;
    lore: string;
    acquired: string;
    origin: string;
    archiveDownload: string;
    derivedDownload: string;
    downloadUnavailable: string;
    rarity: string;
    slotNo: string;
    viewerLoading: string;
    viewerUnsupported: string;
    noModel: string;
    noPhotos: string;
    accessGreen: string;
    accessRed: string;
    accessUnlocked: string;
    shared: string;
    accessShared: string;
    adminInscribeHere: string;
    ownedTag: string;
    ownedBy: string; // {{name}}
    alreadyOwned: string;
    extractedTag: string;
    extractedBy: string; // {{name}}
    jobStatusPending: string;
    jobStatusRunning: string;
    jobStatusSucceeded: string;
    jobStatusFailed: string;
    jobStatusCancelled: string;
    jobStepEnqueued: string;
    jobStepExtractZip: string;
    jobStepPackDerived: string;
    jobStepFinalize: string;
    draftPanelTitle: string;
    draftPanelSubtitle: string;
    draftPanelArchiveLabel: string;
    draftPanelArchiveHint: string;
    draftPanelDescriptionLabel: string;
    draftPanelDescriptionPlaceholder: string;
    draftPanelSubmit: string;
    draftPanelSubmitting: string;
    draftPanelCancel: string;
    draftPanelMissingFile: string;
    draftPanelSubmitFailed: string;
    processingBannerWorking: string; // {{progress}} {{step}}
    processingBannerFailed: string; // {{step}}
    processingBannerCompleted: string;
    processingBannerRetry: string;
    processingBannerRetrying: string;
    cellProcessing: string;
    viewerForging: string;
  };
  agentControl: {
    pageTitle: string;
    pageSubtitle: string; // {{filled}}/{{total}}
    agentRoster: string;
    ordainAgent: string;
    statusOnline: string;
    statusStandby: string;
    statusOffline: string;
    modeMechanical: string;
    modeAutonomous: string;
    modeMechanicalHint: string;
    modeAutonomousHint: string;
    autonomyL0: string;
    autonomyL1: string;
    autonomyL2: string;
    autonomyL3: string;
    classLabel: string;
    syncLevel: string;
    matrixLevel: string;
    baseStats: string;
    heroPortrait: string;
    skillsAndControl: string;
    statChaos: string;
    statChaosHint: string;
    statCost: string;
    statCostHint: string;
    statActivity: string;
    statActivityHint: string;
    statStability: string;
    statStabilityHint: string;
    availableAp: string; // {{n}}
    filterAll: string;
    filterMachines: string;
    filterAgents: string;
    avatarRequired: string;
    deploy: string;
    redeploy: string;
    deploying: string;
    deploySuccess: string;
    deployFailed: string;
    deployedAt: string; // {{when}}
    deployStatusDraft: string;
    deployStatusDeployed: string;
    controlConfigTitle: string;
    controlConfigEdit: string;
    controlConfigEmpty: string;
    controlConfigSummary: string; // {{n}}
    pipelineConfigTitle: string;
    pipelineConfigPlaceholder: string;
    pipelineConfigPending: string;
    dispatcherConfigTitle: string;
    dispatcherConfigPlaceholder: string;
    dispatcherConfigPending: string;
    controlConfigSaving: string;
    controlConfigSave: string;
    controlConfigInvalid: string;
    skillSlotLabel: string; // {{n}}
    skillSlotEmpty: string;
    skillCentralSlotLabel: string;
    skillSlotDetailTitle: string;
    skillSlotDetailUnequip: string;
    skillEmpty: string;
    edit: string;
    remove: string;
    confirmRemove: string; // {{name}}
    deleteFailed: string;
    emptyState: string;
    noAgentSelected: string;
    editorNewLabel: string;
    editorNewTitle: string;
    editorEditLabel: string;
    editorEditTitle: string;
    fieldCodename: string;
    fieldCodenameZh: string;
    fieldNameEn: string;
    fieldNameZh: string;
    fieldStatus: string;
    fieldAvatar: string;
    fieldDescriptionEn: string;
    fieldDescriptionZh: string;
    fieldSkillsJson: string;
    fieldSkillsHelp: string;
    save: string;
    cancel: string;
    saving: string;
    saveFailed: string;
    tabAgents: string;
    tabSkillLibrary: string;
    skillLibraryTitle: string;
    skillKindPassive: string;
    skillKindActive: string;
    skillKindUltimate: string;
    skillLevel: string;
    skillCostAp: string;
    skillEquip: string;
    skillUnequip: string;
    skillUnlock: string;
    skillLock: string;
    skillEquipped: string;
    skillEquipCapacityFull: string;
    skillEquipFailed: string;
    skillCreateNew: string;
    skillEdit: string;
    skillDeleteConfirm: string;
    skillDeleteFailed: string;
    skillSaveFailed: string;
    skillEquippedSkills: string;
    skillEquipFromLibrary: string;
    skillEmptyEquipped: string;
    skillEmptyLibrary: string;
  };
  adminRelics: {
    pageTitle: string;
    pageSubtitle: string;
    backToSanctuary: string;
    addNew: string;
    colSlot: string;
    colName: string;
    colRarity: string;
    colModel: string;
    colPassword: string;
    colActions: string;
    edit: string;
    remove: string;
    confirmRemove: string; // {{name}}
    yes: string;
    no: string;
    formNew: string;
    formEdit: string;
    fSlot: string;
    fSlug: string;
    fNameEn: string;
    fNameZh: string;
    fClassifEn: string;
    fClassifZh: string;
    fRarity: string;
    fIcon: string;
    fOrigin: string;
    fAcquired: string;
    fLoreEn: string;
    fLoreZh: string;
    fPassword: string;
    fPasswordKeep: string;
    fPasswordReset: string;
    fModel: string;
    fPhotos: string;
    fArchive: string;
    fArchiveDownload: string;
    fDerived: string;
    uploadModel: string;
    uploadPhoto: string;
    uploadArchive: string;
    uploadDerived: string;
    uploading: string;
    uploadFailed: string;
    save: string;
    cancel: string;
    saving: string;
    finish: string;
    saveFailed: string;
    extract: string;
    extractConfirm: string; // {{name}}
    move: string;
    moveTitle: string;
    moveTo: string;
    moveSlotInUse: string; // {{slot}}
    share: string;
    shareTitle: string;
    shareSearch: string;
    shareGrant: string;
    shareRevoke: string;
    shareLevel: string; // {{level}}
    shareEmpty: string;
    shareCurrent: string;
    sharedBadge: string;
    grant: string;
    grantTitle: string;
    grantHint: string;
    grantRevoke: string;
    grantConfirm: string; // {{user}}
    grantRevokeConfirm: string; // {{user}}
    shareGrantConfirm: string; // {{user}}
    shareRevokeConfirm: string; // {{user}}
    pendingGrant: string;
    pendingRevoke: string;
    pendingShare: string;
    pendingShareRevoke: string;
    undoQueued: string;
    commitFailed: string;
    adminToolbar: string;
    extractGivenTo: string;
    extractGivenToHint: string;
    extractNotes: string;
    extractNotesHint: string;
    extractKeepBlank: string;
    logTitle: string;
    logEmpty: string;
    logBy: string; // {{actor}}
    logTo: string; // {{target}}
    logActionCREATED: string;
    logActionEDITED: string;
    logActionMOVED: string; // {{from}} {{to}}
    logActionRARITY_CHANGED: string; // {{from}} {{to}}
    logActionSHARED: string;
    logActionSHARE_REVOKED: string;
    logActionEXTRACTED: string;
    logActionEXTRACTED_TO: string; // {{target}}
    logActionGRANTED: string;
    logActionGRANT_REVOKED: string;
    logActionPROCESSING_STARTED: string;
    logActionPROCESSING_STEP: string; // {{step}}
    logActionPROCESSING_SUCCEEDED: string;
    logActionPROCESSING_FAILED: string; // {{step}}
    logTimeJustNow: string;
    logTimeMinutesAgo: string; // {{n}}
    logTimeHoursAgo: string; // {{n}}
    logTimeDaysAgo: string; // {{n}}
    logExpand: string;
    logCollapse: string;
    logFieldsSummary: string; // {{fields}}
    logSubjShared: string; // {{actor}} {{target}}
    logSubjGranted: string; // {{actor}} {{target}}
    logSubjShareRevoked: string; // {{actor}} {{target}}
    logSubjGrantRevoked: string; // {{actor}} {{target}}
    logSubjExtracted: string; // {{actor}}
    logSubjCreated: string; // {{actor}}
    logSubjEdited: string; // {{actor}}
    logSubjMoved: string; // {{actor}}
    logMoveDetails: string; // {{from}} {{to}}
    logPagePrev: string;
    logPageNext: string;
    logPageInfo: string; // {{page}} {{total}}
  };
}
