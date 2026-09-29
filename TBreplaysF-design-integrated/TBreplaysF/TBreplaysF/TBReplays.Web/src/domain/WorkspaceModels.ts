import type { DrawingStrokeModel } from './DrawingModels';
import type { ManualTankModel } from './TankModels';

export type WorkspaceMapDefinition = {
  id: string;
  title: string;
  subtitle: string;
  replayMapName: string;
};

export type StrategySnapshot = {
  manualTanks: ManualTankModel[];
  selectedManualTankId: string | null;
  strokes: DrawingStrokeModel[];
};

export type StrategySlideModel = {
  id: string;
  mapId: string;
  title: string;
  snapshot: StrategySnapshot;
};

export const availableWorkspaceMaps: WorkspaceMapDefinition[] = [
  {
    id: '18_canal_cn-611eae89',
    title: 'Канал',
    subtitle: '18_canal_cn-611eae89',
    // TODO: Временное MVP-решение.
    // Сейчас связь между workspace mapId и названием карты внутри replay хранится локально во frontend map catalog.
    // Потом заменить на backend-каталог карт с aliases: importedMapId, displayName, replayMapNames.
    // Убрать frontend hardcoded replayMapName, когда backend начнёт отдавать нормальный список карт с replay aliases.
    replayMapName: '18_canal_cn',
  },
  {
    id: '16_holland_hl-57cb58dc',
    title: 'Молендейк',
    subtitle: '16_holland_hl-57cb58dc',
    replayMapName: '16_holland_hl',
  },
  {
    id: '09_savanna_sv-4cebd346',
    title: 'Горящие пески',
    subtitle: '09_savanna_sv-4cebd346',
    replayMapName: '09_savanna_sv',
  },
  {
    id: '31_lumber_lm-ec783877',
    title: 'Альпенштадт',
    subtitle: '31_lumber_lm-ec783877',
    replayMapName: '31_lumber_lm',
  },
  {
    id: '35_rift_rt-b9c73d0c',
    title: 'Эллада',
    subtitle: '35_rift_rt-b9c73d0c',
    replayMapName: '35_rift_rt',
  },
  {
    id: '25_canyon_ca-9e248e5d',
    title: 'Каньон',
    subtitle: '25_canyon_ca-9e248e5d',
    replayMapName: '25_canyon_ca',
  },
  {
    id: '30_grossberg_sh-d9ae56ce',
    title: 'Жемчужный город',
    subtitle: '30_grossberg_sh-d9ae56ce',
    replayMapName: '30_grossberg_sh',
  },
  {
    id: '02_desert_train_dt-ddd00f87',
    title: 'Эль-аламейн',
    subtitle: '02_desert_train_dt-ddd00f87',
    replayMapName: '02_desert_train_dt',
  },
  {
    id: '08_idle_id-99346348',
    title: 'Юкон',
    subtitle: '08_idle_id-99346348',
    replayMapName: '08_idle_id',
  },
  {
    id: '05_amigosville_am-2cab7955',
    title: 'Протока',
    subtitle: '05_amigosville_am-2cab7955',
    replayMapName: '05_amigosville_am',
  },
  {
    id: '03_erlenberg_er-419d3bed',
    title: 'Миддлбург',
    subtitle: '03_erlenberg_er-419d3bed',
    replayMapName: '03_erlenberg_er',
  },
  {
    id: '04_medvedkovo_md-3cec3d1c',
    title: 'Эшелон',
    subtitle: '04_medvedkovo_md-3cec3d1c',
    replayMapName: '04_medvedkovo_md',
  },
  {
    id: '11_plant_pn-40d8f210',
    title: 'Промзона',
    subtitle: '11_plant_pn-40d8f210',
    replayMapName: '11_plant_pn',
  },
  {
    id: '12_malinovka_ma-0034803f',
    title: 'Зимняя Малиновка',
    subtitle: '12_malinovka_ma-0034803f',
    replayMapName: '12_malinovka_ma',
  },
  {
    id: '13_pliego_pl-73d6da8a',
    title: 'Кастилья',
    subtitle: '13_pliego_pl-73d6da8a',
    replayMapName: '13_pliego_pl',
  },
];

export const createEmptyStrategySnapshot = (): StrategySnapshot => ({
  manualTanks: [],
  selectedManualTankId: null,
  strokes: [],
});
