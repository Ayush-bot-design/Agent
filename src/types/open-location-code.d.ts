/**
 * Minimal typings for the optional `open-location-code` package used by the
 * smart location parser in `src/utils/deployment-logic.ts`.
 */
declare module 'open-location-code' {
  export interface OpenLocationCodeArea {
    latitudeCenter: number;
    longitudeCenter: number;
    latitudeLo: number;
    longitudeLo: number;
    latitudeHi: number;
    longitudeHi: number;
    codeLength: number;
  }

  export class OpenLocationCode {
    encode(latitude: number, longitude: number, codeLength?: number): string;
    decode(code: string): OpenLocationCodeArea;
    isValid(code: string): boolean;
    isFull(code: string): boolean;
    isShort(code: string): boolean;
    isPadded(code: string): boolean;
    recoverNearest(code: string, referenceLatitude: number, referenceLongitude: number): string;
    shorten(code: string, latitude: number, longitude: number): string;
  }
}
