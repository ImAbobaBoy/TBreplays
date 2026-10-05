export type ScenePoint = { x: number; y: number; z: number };
export type SceneCamera = { position: ScenePoint; quaternion: { x: number; y: number; z: number; w: number }; target: ScenePoint; fov: number };
export type ScenePresenceCommand = { slideId: string; sequence: number; cursor: ScenePoint | null; camera: SceneCamera | null };
export type ScenePresenceFrame = ScenePresenceCommand & { connectionId: string; userId: string; login: string; color: string; updatedAtUnixMs: number };
