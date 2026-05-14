export type TankCoordinateSpace = 'viewer-world-v1';

export type TankVisualKey =
  | 'light'
  | 'medium'
  | 'heavy'
  | 'td';

export type TankTeamKind =
  | 'neutral'
  | 'ally'
  | 'enemy';

export type ManualTankPose = {
  x: number;
  y: number;
  z: number;
  bodyYawDegrees: number;
  turretYawDegrees: number;
};

export type ManualTankAimTarget = {
  x: number;
  y: number;
  z: number;
};

export type ManualTankModel = {
  id: string;
  coordinateSpace: TankCoordinateSpace;
  label: string;
  visualKey: TankVisualKey;
  team: TankTeamKind;
  color: string;
  pose: ManualTankPose;
  aimTarget?: ManualTankAimTarget | null;
};