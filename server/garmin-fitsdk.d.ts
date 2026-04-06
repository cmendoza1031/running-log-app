declare module "@garmin/fitsdk" {
  export class Encoder {
    constructor(options?: { fieldDescriptions?: Record<string, unknown> | null });
    close(): Uint8Array;
    writeMesg(mesg: Record<string, unknown>): this;
    onMesg(mesgNum: number, mesg: Record<string, unknown>): this;
  }
}

declare module "@garmin/fitsdk/src/fit.js" {
  const FIT: {
    File: { WORKOUT: number; ACTIVITY: number; COURSE: number };
    Manufacturer: { DEVELOPMENT: number; GARMIN: number };
    [key: string]: unknown;
  };
  export default FIT;
}

declare module "@garmin/fitsdk/src/profile.js" {
  const Profile: {
    MesgNum: {
      FILE_ID: number;
      WORKOUT: number;
      WORKOUT_STEP: number;
      [key: string]: number;
    };
    [key: string]: unknown;
  };
  export default Profile;
}
