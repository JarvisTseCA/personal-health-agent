/**
 * The built-in "photos" used by the demo's photo upload during onboarding.
 *
 * In the demo, tapping "Upload a photo" loads the sample for that place
 * instead of opening the camera, and the agent's "analysis" is this list:
 * what it identifies, where it is in the picture (for the boxes drawn over
 * the photo) and how the agent describes it. The pictures were drawn for the
 * app, so the analysis always matches what's in them. Swap this for a real
 * vision model call later; the screen only needs the same shape back.
 */
import type { EquipmentPlace } from "../lib/equipment";
import homeUrl from "../assets/samples/home.svg";
import gymUrl from "../assets/samples/gym.svg";

export interface Detection {
  /** Equipment id (see lib/equipment.ts) */
  id: string;
  /** How the agent describes it: "a pair of dumbbells" */
  describe: string;
  /** Where it is, as x, y, width, height in the picture's 480 × 320 frame */
  box: [number, number, number, number];
}

export interface SamplePhoto {
  src: string;
  alt: string;
  /** What the agent says the photo shows, so the analysis reads like a real one */
  scene: string;
  /** Things in the photo that aren't equipment, which the agent says it left out */
  ignored: string;
  detections: Detection[];
}

export const SAMPLE_PHOTO_SIZE = { w: 480, h: 320 };

export const SAMPLE_PHOTOS: Record<EquipmentPlace, SamplePhoto> = {
  home: {
    src: homeUrl,
    alt: "Sample photo: a living-room corner with a yoga mat on the floor, a kettlebell, a pair of dumbbells, a resistance band on a wall hook, a plant and a window",
    scene: "a living-room corner with a wood floor",
    ignored: "the plant and the water bottle",
    detections: [
      { id: "yoga-mat", describe: "a yoga mat laid out on the floor", box: [88, 244, 270, 66] },
      { id: "dumbbells", describe: "a pair of dumbbells", box: [360, 244, 78, 60] },
      { id: "kettlebell", describe: "a kettlebell", box: [36, 222, 52, 58] },
      { id: "resistance-bands", describe: "a resistance band on the wall hook", box: [238, 50, 48, 118] },
    ],
  },
  gym: {
    src: gymUrl,
    alt: "Sample photo: a small gym with a treadmill, a stationary bike, a weight bench, a rowing machine and a dumbbell rack, plus a mirror and a clock",
    scene: "the cardio and weights corner of a small gym",
    ignored: "the mirror and the wall clock",
    detections: [
      { id: "treadmill", describe: "a treadmill", box: [6, 134, 160, 146] },
      { id: "stationary-bike", describe: "a stationary bike", box: [194, 172, 92, 102] },
      { id: "dumbbells", describe: "a dumbbell rack", box: [326, 160, 136, 74] },
      { id: "bench", describe: "a weight bench", box: [124, 276, 104, 36] },
      { id: "rowing-machine", describe: "a rowing machine", box: [256, 264, 210, 50] },
    ],
  },
};
