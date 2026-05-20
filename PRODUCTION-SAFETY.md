# 🚨 PRODUCTION SAFETY CHECKLIST

## NIEMALS ohne diese Checks deployen:

### 1. DB Schema Validation
```bash
# VOR jedem Deployment in Supabase SQL ausführen:
SELECT 
    table_name, 
    column_name, 
    data_type, 
    is_nullable 
FROM information_schema.columns 
WHERE table_name IN ('users', 'notification_log', 'tasks', 'groups')
  AND column_name IN ('twofa_enabled', 'twofa_secret', 'group_id', 'task_id')
ORDER BY table_name, column_name;
```

### 2. Korrupte 2FA States prüfen
```sql
-- MUSS 0 zurückgeben:
SELECT COUNT(*) FROM users 
WHERE twofa_enabled = TRUE AND (twofa_secret IS NULL OR twofa_secret = '');

-- Falls > 0: REPARATUR ausführen:
UPDATE users SET twofa_enabled = FALSE WHERE twofa_secret IS NULL OR twofa_secret = '';
```

### 3. Health Check nach Deployment
```bash
curl https://your-domain.com/api/health-extended
# Status MUSS "healthy" sein, alle checks "ok"
```

### 4. Auth Flow Testing
```bash
# Test 1: Login ohne 2FA
curl -X POST https://your-domain.com/api/auth/login \
  -d '{"email":"test@test.com","password":"test"}'

# Test 2: 2FA Setup Flow  
curl -X POST https://your-domain.com/api/auth/2fa/setup \
  -H "Authorization: Bearer TOKEN"

# Test 3: Profile API
curl https://your-domain.com/api/profile \
  -H "Authorization: Bearer TOKEN"
```

## 🛡️ CRITICAL SAFETY MEASURES

### Auto-Recovery Mechanisms (✅ Implementiert)
- Korrupte 2FA-States (enabled ohne Secret) werden auto-repariert: 2FA wird sauber deaktiviert, Login normal weiter
- otplib-Ausfälle führen zu **HTTP 503 / fail-closed Login** (NIEMALS 2FA-Bypass)
- Schema-Fallbacks in Profile API
- JWT_SECRET wird beim Start validiert (Crash bei fehlendem Secret in Production)

### Monitoring Required
- Daily Health Check Alerts
- 2FA Corruption Detection
- Login Success/Failure Rates
- API Error Rate Monitoring

### Rollback Plan
1. **Sofortiger Rollback** bei Login-Problemen
2. **DB State Repair** SQL-Scripts bereithalten
3. **Emergency 2FA Disable** für kritische Fälle:
   ```sql
   UPDATE users SET twofa_enabled = FALSE WHERE id = 'USER_ID';
   ```

## ⚠️ RED FLAGS - DEPLOYMENT STOPPEN:
- Health Check zeigt "unhealthy" oder "degraded"
- Schema-Validierung schlägt fehl  
- Korrupte 2FA-States gefunden
- otplib Tests schlagen fehl
- Auth API Tests schlagen fehl

## Production-Ready Checklist:
- [ ] Health Check Endpoint deployed
- [ ] Monitoring & Alerting setup
- [ ] DB Schema validated
- [ ] Auth Flow tested end-to-end
- [ ] Emergency rollback plan ready
- [ ] 2FA corruption check = 0
- [ ] Load testing completed