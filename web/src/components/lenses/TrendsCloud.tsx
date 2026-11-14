// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { TrendsCloud as TrendsCloudData, TrendsCloudLook, TrendsDescribe } from '../../api';
import { useLookSources } from '../payoff/parts';
import { splitCitationLetters } from './lenses';

const top = (counts: Record<string, number>, n: number) =>
  Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, n)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ');

/** Bring a cited row or look into view: the citations sit in step 2, the evidence in step 1. */
function reveal(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/**
 * The cloud after the walk: its garments as numbered rows (what [n] cites), then the looks that
 * wear them as lettered cards (what [A] cites), with their photos and everything worn in them,
 * the cloud's own pieces in bold.
 */
export function TrendsCloud({
  cloud,
  label,
  domain,
  activeItem,
  activeLook,
  onItem,
  onLook,
}: {
  cloud: TrendsCloudData;
  label: string;
  domain: string;
  activeItem: number | null;
  activeLook: string | null;
  onItem: (n: number | null) => void;
  onLook: (letter: string | null) => void;
}) {
  const sources = useLookSources(
    cloud.looks.map((l) => l.id),
    domain,
  );
  const c = cloud.counts;
  return (
    <div className="ln-result">
      <p className="ln-headline">
        {label}: {c.items} garments, {c.new} from the new shoot, worn in {c.looks} looks
      </p>
      <p className="muted small">
        {(cloud.ms / 1000).toFixed(1)} s{cloud.edited ? ' · your edited walk' : ''} · occasions: {top(c.occasions, 3) || 'none'} · kinds: {top(c.categories, 3) || 'none'}
        {Object.keys(c.details).length ? ` · details: ${top(c.details, 5)}` : ''}
      </p>
      <div className="po-sec-label">The cloud&apos;s garments</div>
      <div className="ln-trends-items">
        <table className="metrics compact">
          <thead>
            <tr>
              <th>#</th>
              <th>garment</th>
              <th>kind</th>
              <th>details</th>
              <th>colors</th>
              <th>in looks</th>
            </tr>
          </thead>
          <tbody>
            {cloud.items.map((item, i) => (
              <tr key={item.id} id={`ln-trends-item-${i + 1}`} className={activeItem === i + 1 ? 'active' : ''} onClick={() => onItem(activeItem === i + 1 ? null : i + 1)}>
                <td className="muted">{i + 1}</td>
                <td>
                  {item.name}
                  {item.new && <span className="ln-trends-chip">new shoot</span>}
                </td>
                <td>{item.category}</td>
                <td>{item.attributes.join(', ')}</td>
                <td>{item.colors.join(', ')}</td>
                <td>{item.looks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="po-sec-label">
        The looks that wear them{c.looks > cloud.looks.length ? ` (the ${cloud.looks.length} with the most of the cloud's pieces, of ${c.looks})` : ''}
      </div>
      <div className="ln-looks">
        {cloud.looks.map((l) => {
          const s = sources[l.id];
          return <CloudLook key={l.letter} look={l} photo={s ? (s.photo?.data_url ?? null) : undefined} active={activeLook === l.letter} onClick={() => onLook(activeLook === l.letter ? null : l.letter)} />;
        })}
      </div>
    </div>
  );
}

/** One look of the cloud: its photo, letter, occasion, where it comes from, and what it wears (the cloud's pieces in bold). */
function CloudLook({ look, photo, active, onClick }: { look: TrendsCloudLook; photo: string | null | undefined; active: boolean; onClick: () => void }) {
  const mine = new Set(look.from_cloud);
  const shown = [...look.garments.filter((g) => mine.has(g)), ...look.garments.filter((g) => !mine.has(g))];
  return (
    <button type="button" id={`ln-trends-look-${look.letter}`} className={`ln-look${active ? ' active' : ''}`} onClick={onClick}>
      {photo ? (
        <img className="ln-look-img" src={photo} alt={`look ${look.letter}`} loading="lazy" />
      ) : (
        <span className="ln-look-img placeholder" role="img" aria-label={photo === null ? `look ${look.letter}: no photo` : `look ${look.letter}: loading`} />
      )}
      <span className="ln-look-head">
        <b>Look {look.letter}</b> · {look.occasion ?? 'no occasion'} · {look.new ? 'new shoot' : 'lookbook'}
      </span>
      <span className="ln-look-garments">
        {shown.slice(0, 8).map((g, i) => (
          <span key={g}>
            {i > 0 && ' · '}
            {mine.has(g) ? <b>{g}</b> : g}
          </span>
        ))}
        {shown.length > 8 ? ` · +${shown.length - 8} more` : ''}
      </span>
    </button>
  );
}

/** The two descriptions, each citation a link to its item row ([n]) or look card ([A]). */
export function TrendsFindings({
  result,
  activeItem,
  activeLook,
  onItem,
  onLook,
}: {
  result: TrendsDescribe;
  activeItem: number | null;
  activeLook: string | null;
  onItem: (n: number | null) => void;
  onLook: (letter: string | null) => void;
}) {
  const cite = (text: string) =>
    splitCitationLetters(text).map((part, i) => {
      if (typeof part === 'string') return <span key={i}>{part}</span>;
      if (part.kind === 'item') {
        const on = activeItem === part.n;
        return (
          <button
            key={i}
            type="button"
            className={`ln-cite${on ? ' active' : ''}`}
            onClick={() => {
              onItem(on ? null : part.n);
              if (!on) reveal(`ln-trends-item-${part.n}`);
            }}
            title={`garment ${part.n}`}
          >
            {part.n}
          </button>
        );
      }
      const on = activeLook === part.letter;
      return (
        <button
          key={i}
          type="button"
          className={`ln-cite ln-trends-cite-look${on ? ' active' : ''}`}
          onClick={() => {
            onLook(on ? null : part.letter);
            if (!on) reveal(`ln-trends-look-${part.letter}`);
          }}
          title={`look ${part.letter}`}
        >
          {part.letter}
        </button>
      );
    });
  return (
    <>
      <div className="ln-finding">
        <div className="po-who-label">The pieces</div>
        <p>{cite(result.items.text)}</p>
      </div>
      <div className="ln-finding">
        <div className="po-who-label">How the brand wears them</div>
        <p>{cite(result.looks.text)}</p>
      </div>
      <p className="muted small">
        {(result.ms / 1000).toFixed(1)} s · {result.model}
      </p>
    </>
  );
}
