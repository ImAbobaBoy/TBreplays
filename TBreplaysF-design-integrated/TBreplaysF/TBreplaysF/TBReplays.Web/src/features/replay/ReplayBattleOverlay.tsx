import type { ReplayTeamHealthState, ReplayTeamHealthSideState } from '../../domain/ReplayModels';
import { getReplayTeamKind } from '../../engine/replay/ReplayTrackBuilder';
import { selectReplayReload } from '../../engine/replay/ReplayReload';
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
    <small className="replay-battle-frags">Фраги <b>{value(team?.confirmedKills)}</b></small>
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
    {(['ally', 'enemy'] as const).map(kind => {
      const teamId = kind === 'ally' ? data.ally?.teamId ?? recorderTeamId : data.enemy?.teamId;
      return <div key={kind} className={`replay-battle-roster ${kind}`} aria-label={kind === 'ally' ? 'Команда автора реплея' : 'Команда противников'}>
        {presentation.vehicles.filter(vehicle => vehicle.teamId === teamId || kind === 'enemy' && teamId == null && recorderTeamId != null && vehicle.teamId !== recorderTeamId).map(vehicle => {
          const state = data.states.get(vehicle.entityId);
          const health = state?.health ?? null;
          const maximum = vehicle.initialHp ?? vehicle.effectiveHp ?? null;
          const fraction = maximum && health != null ? Math.max(0, Math.min(1, health / maximum)) : 0;
          const reloadTrack = kind === 'ally' ? presentation.playback?.vehicles.find(track => track.entityId === vehicle.entityId) : null;
          const reload = selectReplayReload(reloadTrack?.reload ?? [], data.time);
          const reloadFraction = state?.isAlive === false ? 0 : reload.fraction;
          const reloadLabel = state?.isAlive === false ? 'Танк уничтожен'
            : reload.fraction == null ? (presentation.vehicleStateProtocolVersion ?? 0) < 1
              ? 'Повторно импортируйте реплей для получения данных перезарядки' : 'Данных о перезарядке нет'
            : reload.remainingSeconds === 0 ? 'Орудие заряжено' : `Перезарядка: ${reload.remainingSeconds!.toFixed(1)} с`;
          return <div className={`replay-battle-player${state?.isAlive === false ? ' destroyed' : ''}`} key={vehicle.entityId}
            title={`${vehicle.nickname} · ${vehicle.vehicleName ?? vehicle.vehicleKey ?? 'Танк неизвестен'} · ${value(health)} ХП${state?.healthIsLastKnown ? ' (последнее известное)' : ''}`}>
            <span className="replay-player-fill" style={{ width: `${fraction * 100}%` }} />
            <div className="replay-player-heading"><strong>{vehicle.nickname}</strong><b>{state?.healthIsLastKnown ? '≈ ' : ''}{value(health)}</b></div>
            <small>{vehicle.vehicleName ?? vehicle.vehicleKey ?? 'Танк неизвестен'}</small>
            <span className="replay-player-meter" role="meter" aria-label={`${vehicle.nickname}: ХП`} aria-valuemin={0} aria-valuemax={maximum ?? undefined} aria-valuenow={health ?? undefined} />
            {kind === 'ally' && <span className={`replay-player-reload${reloadFraction == null ? ' unknown' : ''}`}
              role="meter" aria-label={`${vehicle.nickname}: перезарядка`} aria-valuemin={0} aria-valuemax={100}
              aria-valuenow={reloadFraction == null ? undefined : Math.round(reloadFraction * 100)} aria-valuetext={reloadLabel} title={reloadLabel}>
              <span style={{ width: `${(reloadFraction ?? 0) * 100}%` }} />
            </span>}
          </div>;
        })}
      </div>;
    })}
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
