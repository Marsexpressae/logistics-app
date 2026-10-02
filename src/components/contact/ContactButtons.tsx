import { MessageCircle, Phone } from "lucide-react";
import { formatPhone, telLink, whatsappLink, whatsappNumber } from "@/lib/phone";

type ContactButtonsProps = {
  phone: string | null;
  whatsapp?: string | null; // only set when it is a different number
  name?: string;
  compact?: boolean;
  className?: string;
};

/** Two big tap targets: Call, and WhatsApp (using the WhatsApp number when there is a separate one). */
export default function ContactButtons({ phone, whatsapp, name, compact, className = "" }: ContactButtonsProps) {
  const wa = whatsappNumber(phone, whatsapp);
  if (!phone && !wa) return null;

  const base = `inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium touch-manipulation ${
    compact ? "min-h-11 px-3" : "min-h-12 flex-1 px-4"
  }`;
  const who = name ? ` ${name}` : "";

  return (
    <div className={`flex gap-2 ${className}`}>
      {phone && (
        <a
          href={telLink(phone)}
          aria-label={`Call${who} on ${formatPhone(phone)}`}
          className={`${base} border border-slate-300 bg-white text-slate-800 active:bg-slate-100`}
        >
          <Phone className="h-4 w-4" /> Call
        </a>
      )}
      {wa && (
        <a
          href={whatsappLink(wa)}
          target="_blank"
          rel="noreferrer"
          aria-label={`WhatsApp${who} on ${formatPhone(wa)}`}
          className={`${base} bg-green-600 text-white active:bg-green-700`}
        >
          <MessageCircle className="h-4 w-4" /> WhatsApp
        </a>
      )}
    </div>
  );
}
