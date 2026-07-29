/**
 * Privacy and terms.
 *
 * Written to be read, and written to be accurate about this specific system: what
 * is stored, where, for how long, and what is deliberately not collected. If the
 * implementation changes, this page is part of the change.
 */

import { H2, P, PageHead, Prose } from "@/components/layout/Marketing";
import { Seam } from "@/components/ui/Surface";

const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL ?? "";

function Mail() {
  if (!SUPPORT_EMAIL)
    return <span className="text-chalk">the contact address on this site</span>;
  return (
    <a href={`mailto:${SUPPORT_EMAIL}`} className="text-flip underline">
      {SUPPORT_EMAIL}
    </a>
  );
}

function Privacy() {
  return (
    <Prose>
      <P className="text-xs">
        <span className="font-mono text-willow">Last updated: 28 July 2026</span>
      </P>

      <H2>What we store about you</H2>
      <P>
        If you create an account: your email address, the display name you choose, a hash of
        your password (Argon2id — the password itself is never stored or logged), your timezone,
        and the times you signed in. Nothing else about you is required, and there is no profile
        to fill in.
      </P>
      <P>
        For each device you are signed in on, we keep a session record with the browser's
        user-agent string, the IP address it was created from, and when it expires. This exists
        so you can see the list on your account page and cut off a device you no longer have.
        Revoking a session deletes that record.
      </P>

      <H2>What we store about your matches</H2>
      <P>
        The cricket: teams, players' names as you type them, and the ball-by-ball record. Player
        names are the only third-party personal data in the system, and they are there because a
        scorecard without names is useless. Do not enter anything about a player beyond their
        name and role — there is no field for it, and we do not want it.
      </P>
      <P>
        A match you make public is public: anybody with the link can read the scorecard,
        including the names in it. The link is an unguessable slug, not a sequential number, so
        it is not discoverable by counting — but treat it as public, because it is.
      </P>

      <H2>What we do not do</H2>
      <P>
        No advertising, anywhere. No third-party analytics or tracking scripts on the scoring
        screen or the public scorecard. No selling or sharing of data with anyone. No email
        beyond what you ask for — a password reset, or a notice about your own account.
      </P>

      <H2>Cookies and local storage</H2>
      <P>
        The app stores a refresh token and your queued-but-unsent balls in your browser's own
        storage. That is what lets you keep scoring with no signal and stay signed in between
        visits. No cookies are used for tracking. Signing out clears the token.
      </P>

      <H2>Where it lives, and for how long</H2>
      <P>
        Data is held in a managed PostgreSQL database, with a Redis cache used only for
        short-lived live state and rate-limit counters. Backups are retained for 30 days. Delete
        your account and your matches, teams and sessions are removed; the backups age out on
        that same schedule.
      </P>

      <H2>Your rights</H2>
      <P>
        You can export or delete your data at any time — ask at <Mail /> and it will be done
        within 30 days. If you are in the UK, EU or another jurisdiction with equivalent law,
        the usual rights of access, rectification, erasure, restriction and objection apply, and
        you may complain to your local supervisory authority.
      </P>

      <H2>Children</H2>
      <P>
        Accounts are for people aged 13 and over. Players named on a scorecard may of course be
        younger; if you are a parent or guardian and want a child's name removed from a
        scorecard, write to <Mail /> and we will remove it.
      </P>

      <H2>Changes</H2>
      <P>
        If this policy changes in a way that affects what we collect, the date above changes and
        the change is listed on the changelog page.
      </P>
    </Prose>
  );
}

function Terms() {
  return (
    <Prose>
      <P className="text-xs">
        <span className="font-mono text-willow">Last updated: 28 July 2026</span>
      </P>

      <H2>The short version</H2>
      <P>
        Use it to score cricket. Do not abuse it or break it. It is provided free and without
        warranty, and we will not be liable if a scorecard is wrong — a scorer is.
      </P>

      <H2>Your account</H2>
      <P>
        You are responsible for what happens under your account, including anything a
        collaborator you invite records. Keep your password to yourself; if you think it has
        been used by someone else, change it, which signs every other device out.
      </P>

      <H2>Acceptable use</H2>
      <P>
        Do not use the service to store or publish anything unlawful, abusive or defamatory — a
        commentary field is not a place to insult a player. Do not attempt to access matches you
        were not given access to, probe or overload the API, or scrape the public pages at a
        rate that affects other people. Automated access is rate-limited; deliberately working
        around the limits is grounds for suspension.
      </P>

      <H2>Your content</H2>
      <P>
        The matches, teams and scores you enter remain yours. You grant us only what is needed
        to run the service: storing that data, computing from it, and showing it on the public
        pages you choose to publish. We claim no ownership and will not use it for anything
        else.
      </P>

      <H2>Availability</H2>
      <P>
        We aim to keep the service up and we design for a bad connection — but this is free
        software running on paid infrastructure, and there is no uptime guarantee. Because balls
        are written to your own device first, an outage during a match does not lose your
        scoring.
      </P>

      <H2>Accuracy</H2>
      <P>
        The scoring engine implements the Laws of Cricket as carefully as we know how, and its
        behaviour is covered by a shared test suite. It is still software written by people. A
        scorecard produced here is not an official record unless your competition says it is,
        and the result of a match is decided by the umpires, not by this app.
      </P>

      <H2>Ending it</H2>
      <P>
        You may delete your account whenever you like. We may suspend an account that is being
        used to break these terms, and will say why unless we are legally unable to.
      </P>

      <H2>Liability</H2>
      <P>
        To the extent the law allows, the service is provided "as is" without warranties of any
        kind, and we are not liable for indirect or consequential loss — including any loss
        arising from an incorrect score, a lost match, or a decision made on the basis of
        either. Nothing here limits liability that cannot lawfully be limited.
      </P>

      <H2>Questions</H2>
      <P>
        Write to <Mail />.
      </P>
    </Prose>
  );
}

export default function Legal({ document }: { document: "privacy" | "terms" }) {
  const privacy = document === "privacy";
  return (
    <>
      <PageHead
        eyebrow="Legal"
        title={privacy ? "Privacy" : "Terms of use"}
        lede={
          privacy
            ? "What is stored, where it lives, and what we deliberately do not collect. Written in plain sentences, because a policy nobody reads protects nobody."
            : "The rules for using Pitchside. Short, because there is not much to say about a free cricket scorebook."
        }
      />
      <Seam />
      {privacy ? <Privacy /> : <Terms />}
    </>
  );
}
