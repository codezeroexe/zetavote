import React from "react";
import { KeyPattern, SealStamp } from "./Hole";

/**
 * The card.
 *
 * This is the one surface in the product that is not a panel of the machine, and
 * it is the only warm object on the page — which is why it is reserved for the
 * three things that actually carry a claim: the ballot being punched, the
 * published total, and the receipt the machine prints back.
 *
 * Its structure is a real card's: a band across the top carrying the keying
 * station's dead-zone punch and the column count, a gutter of slots down the
 * leading edge where a key enters, and field rules between the fields. The
 * clip corner is the one shape on it that is not a rectangle, and it is why
 * nothing else in this design system is rounded.
 */

interface CardStockProps {
  /** Printed in the band, in the fixed pitch a card prints its own headings. */
  title: string;
  /** The election or ballot id, if the card has one. */
  id?: string;
  /**
   * Stamps the card as sealed. Used on a card that will take no further punches:
   * a ballot whose window has closed, and a receipt that has been issued.
   */
  sealed?: boolean;
  /** Stamped under SEAL, e.g. the election id. */
  sealedSub?: string;
  bandExtra?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export const CardStock: React.FC<CardStockProps> = ({
  title,
  id,
  sealed = false,
  sealedSub,
  bandExtra,
  children,
  className = "",
}) => (
  <div className={`zv-card-stock ${className}`.trim()}>
    <div className="zv-card-band">
      <div className="zv-card-band-left">
        <KeyPattern />
        <span className="zv-card-band-title">{title}</span>
        {id && <span className="zv-card-band-id">{id}</span>}
        {bandExtra}
      </div>
      <span className="zv-card-cols">80 COL</span>
    </div>

    <div className={`zv-card-face${sealed ? " zv-ballot-closed" : ""}`}>
      <div className="zv-card-gutter" aria-hidden="true" />
      {children}
      {sealed && (
        <div className="zv-seal-slot">
          <SealStamp sub={sealedSub ?? id} />
        </div>
      )}
    </div>
  </div>
);
