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
    introductionHeading: string;
    introductionBody: string;
    originHeading: string;
    originBody: string;
    codename: string;
    portraitAlt: string;
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
    machineVisionTitle: string;
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
}
