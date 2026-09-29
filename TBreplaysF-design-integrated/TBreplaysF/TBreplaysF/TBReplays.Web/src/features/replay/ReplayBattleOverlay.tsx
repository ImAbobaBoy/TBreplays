import type { ReplayTeamHealthState, ReplayTeamHealthSideState } from '../../domain/ReplayModels';
import { getReplayTeamKind } from '../../engine/replay/ReplayTrackBuilder';
import './replayBattleOverlay.css';

const value = (n: number | null | undefined) => n == null ? '—' : n.toLocaleString('ru-RU');

function Team({ team, kind }: { team: ReplayTeamHealthSideState | null; kind: string }) {
  const fraction = team?.initialHp && team.lastKnownHp != null
    ? Math.max(0, Math.min(1, team.lastKnownHp / team.initialHp)) : null;
  return <div className={`replay-battle-team ${kind}`}>
    <span>{team?.label ?? 'Команда не определена'}</span>
    <strong title={team?.hasUnobservedHealth ? 'Включает последние известные HP скрытых танков' : undefined}>
      {team?.hasUnobservedHealth ? '≈ ' : ''}{value(team?.lastKnownHp)} / {value(team?.initialHp)} HP
    </strong>
    <div className="replay-battle-hp" role="meter" aria-label={`${team?.label ?? 'Команда'}: HP`}
      aria-valuemin={0} aria-valuemax={team?.initialHp ?? undefined}
      aria-valuenow={team?.lastKnownHp ?? undefined} aria-valuetext={value(team?.lastKnownHp)}>
      <span style={{ width: `${(fraction ?? 0) * 100}%` }} />
    </div>
    <b className="replay-battle-points">Превосходство: {value(team?.supremacyPoints)}</b>
    <small>В строю: {value(team?.aliveCount)} · Уничтожено: {value(team?.confirmedKills)}</small>
  </div>;
}

export function ReplayBattleOverlay({ data }: { data: ReplayTeamHealthState | null }) {
  if (!data) return null;
  const { presentation, resultVisible } = data;
  const recorderTeamId = data.ally?.teamId ?? presentation.recorderTeamId;
  const outcome = presentation.outcome;
  const result = outcome.status === 'draw' ? 'Ничья'
    : outcome.winnerTeamId == null || outcome.status === 'unknown' ? 'Исход неизвестен'
    : recorderTeamId == null ? `Победила команда ${outcome.winnerTeamId}`
    : outcome.winnerTeamId === recorderTeamId ? 'Победа' : 'Поражение';
  return <div className="replay-battle-overlay">
    <div className="replay-battle-scoreboard">
      <Team team={data.ally} kind="ally" /><Team team={data.enemy} kind="enemy" />
    </div>
    {resultVisible && <div className="replay-battle-result">{result} · {outcome.reasonName}
      {!outcome.sourcesAgree && ' · Источники результата расходятся'}
    </div>}
    <details className="replay-battle-details">
      <summary>Танки и снаряжение</summary>
      <div className="replay-battle-table-scroll">
        <table><thead><tr><th>Игрок / танк</th><th>HP сейчас / старт</th><th>Уничтожено</th>
          {resultVisible && <th>Урон за бой</th>}<th>Снаряжение</th></tr></thead>
          <tbody>{presentation.vehicles.map(vehicle => {
            const state = data.states.get(vehicle.entityId);
            return <tr key={vehicle.entityId} className={getReplayTeamKind(vehicle.teamId, recorderTeamId)}>
              <td>{vehicle.nickname}<small>{vehicle.vehicleName ?? vehicle.vehicleKey ?? 'Танк неизвестен'}</small></td>
              <td>{state?.healthIsLastKnown ? '≈ ' : ''}{value(state?.health)} / {value(vehicle.initialHp)}</td>
              <td>{value(state?.confirmedKills)}</td>
              {resultVisible && <td>{value(vehicle.damageDealt)}</td>}
              <td>{state?.extras.length ? state.extras.map(extra => <div key={extra.extraId}>
                {extra.name || extra.key || `ID ${extra.extraId}`} — {extraStateLabel(extra.state)}
              </div>) : 'Нет наблюдений'}
                {resultVisible && vehicle.extras.filter(extra => extra.kind === 'consumable').map(extra =>
                  <small key={extra.extraId} title={`Прямых: ${extra.directUses}; косвенных: ${extra.inferredUses}`}>
                    {extra.name}: {extra.usageMayBeIncomplete ? 'не менее ' : ''}{extra.minimumUses} использований
                  </small>)}
              </td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    </details>
  </div>;
}

function extraStateLabel(state: string): string {
  const labels: Record<string, string> = { Installed: 'установлено', Activated: 'активно',
    Cooldown: 'перезарядка', Cleanup: 'эффект завершён', Unknown: 'состояние неизвестно',
    UnknownAfterActivation: 'состояние после активации неизвестно' };
  return labels[state] ?? state;
}
