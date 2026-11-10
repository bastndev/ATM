# 🧠 AI Data ID (`01-ai-data-id`) — Monitor de Cuota para Antigravity

Módulo de monitoreo en tiempo real de consumo de modelos de IA y cuotas para **Google Antigravity** (tanto **Antigravity IDE 1.x** como **Antigravity 2.0** y el CLI **`agy`**).

---

## ✨ Novedades de la Actualización (Compatibilidad Antigravity 2.0)

Esta actualización moderniza la arquitectura del módulo para convivir de forma nativa con la nueva generación de **Antigravity 2.0**, el binario unificado `language_server` y el flujo de trabajo con el CLI `agy`:

1. **Descubrimiento Multi-Binario (`ProcessFinder`)**:
   - Soporte extendido para nombres de proceso modernos y heredados:
     - **macOS**: `language_server`, `language_server_macos_arm`, `language_server_macos`
     - **Windows**: `language_server.exe`, `language_server_windows_x64.exe`, `language_service_windows_x64.exe`
     - **Linux**: `language_server`, `language_server_linux_x64`, `language_server_linux_arm`
   - Extracción flexible del token CSRF compatible con `--csrf_token`, `--csrf-token` y `--csrfToken`.
   - Detección directa de puertos desde argumentos CLI (`--extension_server_port`, `--server_port`, `--port`), acelerando la conexión sin depender exclusivamente de `lsof` o `ss`.

2. **Soporte Dual de Endpoints Connect-RPC (`QuotaManager`)**:
   - **Primario / Detallado**: `POST /exa.language_server_pb.LanguageServerService/GetUserStatus`
   - **Nuevo Estándar Antigravity 2.0**: `POST /exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary`
   - Soporta agrupaciones por familia (`Gemini Models`, `Claude and GPT models`) y ventanas de límite de **5 horas (`5h`)** y **semanales (`weekly`)**.
   - Envío simultáneo de cabeceras `X-CSRF-Token` y `X-Codeium-Csrf-Token`.

3. **Nuevas Familias de Modelos y Paletas Visuales (`tooltip-builder.ts`)**:
   - Incorporación de modelos de última generación: **Gemini 4 Argon (High/Low)**, **Gemini 3.8 Pro**, **Gemini 3.8 Flash**, **Gemini 3.5**, **Claude 3.7 Sonnet**, **Claude 4.6 Sonnet/Opus** y **GPT-OSS**.
   - Cálculo ponderado por *baskets* (`PRO`, `FLASH`, `THIRD_PARTY`) adaptado a planes `FREE`, `PRO` y `ULTRA`.

4. **Coexistencia Multi-Editor (`index.ts`)**:
   - Se activa automáticamente dentro de **Antigravity IDE**.
   - En editores hermanos (VS Code, Cursor, Windsurf), detecta silenciosamente en segundo plano si **Antigravity 2.0** o `agy` están ejecutándose en la máquina y habilita la barra de estado de forma dinámica sin mostrar errores intrusivos cuando Antigravity está cerrado.

---

## 📂 Arquitectura del Módulo

```text
01-ai-data-id/
├── index.ts                 ← Ciclo de vida, barra de estado y polling adaptativo (3 niveles)
├── README.md                ← Documentación técnica e historial de actualización
├── core/
│   ├── types.ts             ← Contratos de datos (GetUserStatus + RetrieveUserQuotaSummary)
│   ├── process-finder.ts    ← Detección multiplataforma de PID, puertos CLI/OS y CSRF token
│   └── quota-manager.ts     ← Cliente HTTPS Connect-RPC con cadena de fallback automática
└── ui/
    └── tooltip-builder.ts   ← Renderizado del tooltip Markdown, barras de progreso y tokens
```

---

## ✍️ Firma y Autoría de Actualización

* **Actualizado y documentado por**: **Enrique H. Hernandez** ([@EnriqueHH](https://github.com/EnriqueHH)) — `<poke.henri@gmail.com>`
* **Fecha de aportación**: Octubre 2026
* **Alcance de la contribución**: Adaptación integral para compatibilidad con Antigravity 2.0, soporte de `RetrieveUserQuotaSummary`, detección de procesos/puertos CLI, soporte para nuevos modelos Gemini 4 Argon / 3.8 y cobertura de pruebas unitarias.

