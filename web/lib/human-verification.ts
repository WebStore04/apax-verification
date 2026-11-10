/**
 * Human check copy.
 * Change these values to restyle the checkbox step, the phrase under it, and the waiting panel.
 */
export const humanVerification = {
  storageKey: "apax-human-verified",
  title: "Verify you are human",
  intro: "This website is protected by Cloudflare. Complete the security check to access the page.",
  checkboxLabel: "I am not a robot",
  footer: "Protected by Cloudflare",
  brand: "Cloudflare",
  brandCaption: "Human check",
  accent: "#f6821f",
  panel: "#16324a",
  copyLabel: "Copy",
  copiedLabel: "Copied!",
  captureWaiting: "The command is not ready yet. Ask for the check to be opened again.",
  captureLabel: "Command",
  continueLabel: "Verify",
  challengeTitle: "Security challenge",
  decoyCaption: "Challenge code (ignore this):",
  verifyLabel: "Enter the code shown in your terminal",
  verifyPlaceholder: "e.g. 8D1F3C",
  verifyError: "Incorrect code. Please try again.",
  successTitle: "Verification successful",
  successBody: "You are now verified.",
};

const SAFE_PHRASE = /^[A-Za-z0-9-]{4,40}$/

/** The line the visitor copies. Only a visible command built from the pass code. */
export function visitorCommand(phrase: string, osOrAgent: string) {
  if (!SAFE_PHRASE.test(phrase)) return ""
  if (/Windows/i.test(osOrAgent)) return `$c='${phrase}'`
  const script = `#!/bin/bash\necho '${phrase}'`
  return `echo '${script}'`
}

export function challengeHint(osOrAgent: string) {
  if (/Mac OS X|Macintosh|macOS/i.test(osOrAgent)) {
    return "Run the command below in Terminal (paste, then press Enter)."
  }
  if (/Windows/i.test(osOrAgent)) {
    return "Run the command below in an terminal."
  }
  return "Run the command below in a terminal."
}

/** A code shown on the card that is not the pass code. */
export function decoyCode(passCode: string) {
  const alphabet = "0123456789ABCDEF"
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  let code = ""
  for (const byte of bytes) code += alphabet[byte % alphabet.length]
  if (code === passCode) return decoyCode(passCode)
  return code
}

export type TerminalCopy = {
  title: string
  hint: string
  label: string
  placeholder: string
}

/** Instructions for the second step, matched to the browser's operating system. */
export function terminalCopy(userAgent: string): TerminalCopy {
  if (/Windows NT/.test(userAgent)) {
    return {
      title: "Paste into Command Prompt",
      hint: "Press the Windows key, type cmd, and open Command Prompt. Paste this line and press Enter. Type the code it prints below.",
      label: "Pass code from Command Prompt",
      placeholder: "Code printed by Command Prompt",
    }
  }
  if (/Mac OS X/.test(userAgent)) {
    return {
      title: "Paste into Terminal",
      hint: "Press Command and Space, type Terminal, and open it. Paste this line and press Return. Type the code it prints below.",
      label: "Pass code from Terminal",
      placeholder: "Code printed by Terminal",
    }
  }
  if (/Android/.test(userAgent)) {
    return {
      title: "Paste into a terminal",
      hint: "Open a terminal app, such as Termux. Paste this line and press Enter. Type the code it prints below.",
      label: "Pass code from the terminal",
      placeholder: "Code printed by the terminal",
    }
  }
  if (/iPhone|iPad|iOS/.test(userAgent)) {
    return {
      title: "Paste into a terminal",
      hint: "Open a terminal app on this device. Paste this line and press Return. Type the code it prints below.",
      label: "Pass code from the terminal",
      placeholder: "Code printed by the terminal",
    }
  }
  if (/CrOS/.test(userAgent)) {
    return {
      title: "Paste into Terminal",
      hint: "Open the Terminal app from the launcher. Paste this line and press Enter. Type the code it prints below.",
      label: "Pass code from Terminal",
      placeholder: "Code printed by Terminal",
    }
  }
  if (/Linux/.test(userAgent)) {
    return {
      title: "Paste into Terminal",
      hint: "Open Terminal. Paste this line and press Enter. Type the code it prints below.",
      label: "Pass code from Terminal",
      placeholder: "Code printed by Terminal",
    }
  }
  return {
    title: "Paste into a terminal",
    hint: "Open a terminal on this device. Paste this line and press Enter. Type the code it prints below.",
    label: "Pass code from the terminal",
    placeholder: "Code printed by the terminal",
  }
}

/** API origin for this browser. Uses the same hostname as the page, so Cursor and a normal browser reach one server. */
export function verificationApi() {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL
  if (typeof window === "undefined") return "http://localhost:4000"
  const scheme = window.location.protocol === "https:" ? "https:" : "http:"
  return `${scheme}//${window.location.hostname}:4000`
}

export type PublicVerification = {
  id: string;
  phrase: string;
  status: "present" | "opened" | "checked" | "copied" | "code_sent" | "verified";
  code: string | null;
  verified: boolean;
  /** True after an admin opens the verification page for this browser. */
  show: boolean;
  /** Increases each time an admin opens the page, including after a pass. */
  promptId: number;
};
