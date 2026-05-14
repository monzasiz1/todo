# Stripe Setup für BeeQu

So aktivierst du die Abo-Abrechnung in Production.

## 1. Stripe-Account vorbereiten

1. **Account** auf <https://dashboard.stripe.com> anlegen (oder bestehenden nehmen).
2. **Produkt + Preise** anlegen — empfohlen: 2 Produkte, je 2 Preise:

   | Produkt | Preis monatlich | Preis jährlich |
   |---------|-----------------|----------------|
   | BeeQu Pro  | 4,99 € / Monat | 49,99 € / Jahr |
   | BeeQu Team | 9,99 € / Monat | 99,99 € / Jahr |

   Beim Anlegen: **Recurring** mit Intervall `monthly` bzw. `yearly`. Die Beträge können beliebig angepasst werden — wichtig ist nur die Zuordnung Plan ↔ Intervall ↔ Price-ID.

   Du bekommst nach dem Speichern jeweils eine **Price-ID** in der Form `price_1Q...`.

3. **Customer-Portal aktivieren**: Stripe Dashboard → *Settings → Billing → Customer portal* → aktivieren und ausreichende Optionen (Kündigen, Rechnungen) erlauben.

## 2. Webhook anlegen

Im Stripe-Dashboard → *Developers → Webhooks → Add endpoint*:

- **Endpoint URL**: `https://beequ.de/api/billing/webhook`
- **Listen to**: events on your account
- **Select events**:
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.paid`

Nach dem Anlegen den **Signing secret** kopieren (`whsec_...`).

## 3. Vercel-Environment-Variablen

In Vercel → Project → *Settings → Environment Variables* anlegen (Production **und** Preview):

| Name | Wert |
|------|------|
| `STRIPE_SECRET_KEY`       | `sk_live_...` (oder `sk_test_...` für Preview) |
| `STRIPE_WEBHOOK_SECRET`   | `whsec_...` aus dem Webhook |
| `STRIPE_PRICE_PRO_MONTH`  | Price-ID Pro monatlich |
| `STRIPE_PRICE_PRO_YEAR`   | Price-ID Pro jährlich |
| `STRIPE_PRICE_TEAM_MONTH` | Price-ID Team monatlich |
| `STRIPE_PRICE_TEAM_YEAR`  | Price-ID Team jährlich |
| `APP_BASE_URL`            | `https://beequ.de` |

Nach dem Speichern **Redeploy** auslösen, damit die Env-Variablen in die Functions kommen.

## 4. Wie der Flow läuft

1. Nutzer klickt im `UpgradeModal` auf „Pro wählen" → Frontend ruft `POST /api/billing/checkout` mit `{ plan, interval }`.
2. Backend erstellt (falls nötig) einen Stripe-Customer und eine **Checkout-Session**, gibt die URL zurück.
3. Frontend leitet zu Stripe-Checkout um. Nach Zahlung redirected Stripe auf `/app/upgrade/success?session_id=...`.
4. Parallel sendet Stripe das `checkout.session.completed`-Webhook an `/api/billing/webhook` — dort wird `plan`, `plan_interval` und `plan_expires_at` auf `current_period_end` gesetzt (also automatisch +1 Monat oder +1 Jahr).
5. Die Success-Page pollt zusätzlich `/api/billing/session?id=...` für den Fall, dass der Webhook ausnahmsweise später kommt, und ruft `/api/plans/me` ab, um die Anzeige sofort zu aktualisieren.
6. Bei Verlängerung sendet Stripe `customer.subscription.updated` + `invoice.paid` → `plan_expires_at` wird automatisch verschoben.
7. Bei Kündigung / Zahlungsausfall sendet Stripe `customer.subscription.deleted` → Nutzer fällt zurück auf `free`.

## 5. Test-Modus

Für lokale Tests:
- `STRIPE_SECRET_KEY=sk_test_...`
- Testkarte `4242 4242 4242 4242`, beliebiges zukünftiges Datum, beliebiger CVC.
- Webhook lokal via `stripe listen --forward-to localhost:3000/api/billing/webhook` (`stripe` CLI), das gibt dir einen Test-`whsec_...`.

## 6. Abo verwalten / kündigen

Im `UpgradeModal` erscheint für zahlende Nutzer der Button **„Abo verwalten / kündigen"** → öffnet das Stripe-Customer-Portal. Dort kann der Nutzer Zahlungsmethode ändern, Rechnungen herunterladen und kündigen.

## 7. DB-Schema

Wird beim ersten Aufruf von `/api/billing/*` automatisch (idempotent) erweitert um:

- `users.stripe_customer_id` (text, indexed)
- `users.stripe_subscription_id` (text, indexed)
- `users.plan_interval` (`'month'` | `'year'` | `null`)
- `users.plan_expires_at` (timestamptz)
- `users.plan_updated_at` (timestamptz)

Kein manuelles Migrieren nötig.
