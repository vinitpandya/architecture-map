/**
 * Turns the Meridian estate (estate.mjs) into ten schema-valid manifests, one
 * per repository, each carrying file paths and code snippets plausible for the
 * language that repo is written in.
 *
 * Nothing here is clever on purpose. A manifest is what a scan of that one
 * repository could have seen, so every fact is emitted from the side that can
 * evidence it: a producer knows the payload class it serialises, a caller
 * knows the path it requests, and neither knows what the other end does.
 */

import {
  BINDINGS, CACHES, CONTRACTS, DATABASES, DB_ACCESS, ENDPOINTS, EXTERNALS,
  SERVICES, TOPICS, UNRESOLVED, VERSION, byRepo,
} from './estate.mjs'

const PROMPT_VERSION = '2026-09-18a'
const SCAN_DAY = '2026-09-18'

/* ─────────────────────────────────────────────────────────────── helpers */

/** Stable 32-bit hash. Line numbers and commit shas must not move per run. */
function hash(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const commitFor = (repo) => hash(`commit:${repo}`).toString(16).padStart(8, '0').slice(0, 7)

/** 08:00 UTC plus seven minutes per repo, so the scan log reads like a run. */
const scannedAt = (i) =>
  `${SCAN_DAY}T${String(8 + Math.floor((i * 7) / 60)).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}:00Z`

const pascal = (s) => s.replace(/(^|[^a-z0-9])([a-z0-9])/gi, (_, __, c) => c.toUpperCase())
const snake = (s) => s.replace(/[.\-/]/g, '_')
const camel = (s) => {
  const p = pascal(s)
  return p[0].toLowerCase() + p.slice(1)
}

/** `users.created.v2` → `USERS_CREATED`: the constant a repo would declare. */
const constName = (topic) => snake(topic.replace(/\.v\d+$/, '')).toUpperCase()
/** …and Go's spelling of the same thing. */
const goConst = (topic) => `Topic${pascal(topic.replace(/\.v\d+$/, '').replace(/\./g, '-'))}`

const eventClass = (contractId) => contractId.slice(contractId.lastIndexOf('.') + 1)
const shortRepo = (repo) => repo.replace(/-(service|api|engine)$/, '')

/* ───────────────────────────────────────────────────────────── templates

   [file, snippet] per language and relationship, with <<name>> substituted
   from the context. The delimiter is deliberately not `{}` — half these
   snippets contain braces of their own. */

const render = (s, ctx) => s.replace(/<<(\w+)>>/g, (_, k) => (ctx[k] ?? ''))

const KOTLIN = {
  topicConst: ['src/main/kotlin/com/meridian/<<pkg>>/kafka/Topics.kt', 'const val <<CONST>> = "<<topic>>"'],
  produce: ['src/main/kotlin/com/meridian/<<pkg>>/kafka/<<Class>>Publisher.kt', 'kafka.send(Topics.<<CONST>>, event.key(), event)'],
  consume: ['src/main/kotlin/com/meridian/<<pkg>>/kafka/<<Class>>Listener.kt', '@KafkaListener(topics = [Topics.<<CONST>>], groupId = "<<repo>>")'],
  schema: ['src/main/kotlin/com/meridian/<<pkg>>/kafka/<<Class>>Publisher.kt', 'val event: <<Event>> = <<Event>>.from(state)'],
  migration: ['src/main/resources/db/migration/V1__init.sql', 'CREATE TABLE <<table>> ('],
  dbWrite: ['src/main/kotlin/com/meridian/<<pkg>>/store/<<Class>>Repository.kt', 'jdbc.update("INSERT INTO <<table>> (id, updated_at) VALUES (?, ?)", id, now)'],
  dbRead: ['src/main/kotlin/com/meridian/<<pkg>>/store/<<Class>>Repository.kt', 'jdbc.query("SELECT * FROM <<table>> WHERE id = ?", rowMapper, id)'],
  esOwns: ['src/main/kotlin/com/meridian/<<pkg>>/search/IndexBootstrap.kt', 'client.indices().create { it.index("<<table>>").mappings(MAPPING) }'],
  esWrite: ['src/main/kotlin/com/meridian/<<pkg>>/search/<<Class>>Indexer.kt', 'client.index { it.index("<<table>>").id(doc.id).document(doc) }'],
  esRead: ['src/main/kotlin/com/meridian/<<pkg>>/search/<<Class>>Search.kt', 'client.search({ it.index("<<table>>").query(query) }, Report::class.java)'],
  cacheWrite: ['src/main/kotlin/com/meridian/<<pkg>>/cache/<<Class>>Cache.kt', 'redis.opsForValue().set("<<name>>:$key", value, Duration.ofMinutes(30))'],
  cacheRead: ['src/main/kotlin/com/meridian/<<pkg>>/cache/<<Class>>Cache.kt', 'redis.opsForValue().get("<<name>>:$key")'],
  expose: ['src/main/kotlin/com/meridian/<<pkg>>/api/<<Class>>Controller.kt', '@<<Verb>>Mapping("/<<handler>>")'],
  call: ['src/main/kotlin/com/meridian/<<pkg>>/client/<<TargetClass>>Client.kt', '@<<Verb>>Mapping("/<<handler>>")'],
  baseUrl: ['src/main/resources/application.yml', '<<targetShort>>.base-url: http://<<target>>:8080'],
  contract: ['build.gradle.kts', 'implementation("com.meridian:platform-events:<<version>>")'],
  external: ['src/main/kotlin/com/meridian/<<pkg>>/psp/<<Ext>>Gateway.kt', 'private val base = "<<base>>"'],
}

const JAVA = {
  topicConst: ['src/main/java/com/meridian/<<pkg>>/kafka/Topics.java', 'public static final String <<CONST>> = "<<topic>>";'],
  produce: ['src/main/java/com/meridian/<<pkg>>/kafka/<<Class>>Publisher.java', 'producer.send(new ProducerRecord<>(Topics.<<CONST>>, event.key(), event));'],
  consume: ['src/main/java/com/meridian/<<pkg>>/kafka/<<Class>>Listener.java', '@KafkaListener(topics = Topics.<<CONST>>, groupId = "<<repo>>")'],
  schema: ['src/main/java/com/meridian/<<pkg>>/kafka/<<Class>>Publisher.java', '<<Event>> event = <<Event>>.newBuilder().setTradeId(trade.id()).build();'],
  migration: ['src/main/resources/db/migration/V1__init.sql', 'CREATE TABLE <<table>> ('],
  dbWrite: ['src/main/java/com/meridian/<<pkg>>/store/<<Class>>Repository.java', 'jdbc.update("INSERT INTO <<table>> (id, updated_at) VALUES (?, ?)", id, now);'],
  dbRead: ['src/main/java/com/meridian/<<pkg>>/store/<<Class>>Repository.java', 'jdbc.query("SELECT * FROM <<table>> WHERE id = ?", mapper, id);'],
  esOwns: ['src/main/java/com/meridian/<<pkg>>/search/IndexBootstrap.java', 'client.indices().create(c -> c.index("<<table>>").mappings(MAPPING));'],
  esWrite: ['src/main/java/com/meridian/<<pkg>>/search/<<Class>>Indexer.java', 'client.index(i -> i.index("<<table>>").id(doc.id()).document(doc));'],
  esRead: ['src/main/java/com/meridian/<<pkg>>/search/<<Class>>Search.java', 'client.search(s -> s.index("<<table>>").query(query), Report.class);'],
  cacheWrite: ['src/main/java/com/meridian/<<pkg>>/cache/<<Class>>Cache.java', 'redis.opsForValue().set("<<name>>:" + key, value, Duration.ofMinutes(30));'],
  cacheRead: ['src/main/java/com/meridian/<<pkg>>/cache/<<Class>>Cache.java', 'redis.opsForValue().get("<<name>>:" + key);'],
  expose: ['src/main/java/com/meridian/<<pkg>>/api/<<Class>>Controller.java', '@<<Verb>>Mapping("/<<handler>>")'],
  call: ['src/main/java/com/meridian/<<pkg>>/client/<<TargetClass>>Client.java', '@<<Verb>>Mapping("/<<handler>>")'],
  baseUrl: ['src/main/resources/application.yml', '<<targetShort>>.base-url: http://<<target>>:8080'],
  contract: ['build.gradle', "implementation 'com.meridian:platform-events:<<version>>'"],
  external: ['src/main/java/com/meridian/<<pkg>>/psp/<<Ext>>Gateway.java', 'private static final String BASE = "<<base>>";'],
}

const GO = {
  topicConst: ['internal/kafka/topics.go', '<<GoConst>> = "<<topic>>"'],
  produce: ['internal/kafka/publisher.go', 'w.WriteMessages(ctx, kafka.Message{Topic: <<GoConst>>, Value: payload})'],
  consume: ['internal/kafka/consumer.go', 'r := kafka.NewReader(kafka.ReaderConfig{Topic: <<GoConst>>, GroupID: "<<repo>>"})'],
  schema: ['internal/kafka/publisher.go', 'payload, err := json.Marshal(events.<<Event>>{Symbol: t.Symbol, Price: t.Price})'],
  migration: ['migrations/0001_init.sql', 'CREATE TABLE <<table>> ('],
  dbWrite: ['internal/store/postgres.go', '_, err := s.db.ExecContext(ctx, `INSERT INTO <<table>> (symbol, price, at) VALUES ($1, $2, $3)`, sym, px, at)'],
  dbRead: ['internal/store/postgres.go', 'row := s.db.QueryRowContext(ctx, `SELECT price FROM <<table>> WHERE symbol = $1 ORDER BY at DESC LIMIT 1`, sym)'],
  esOwns: ['internal/search/bootstrap.go', 'es.Indices.Create("<<table>>", es.Indices.Create.WithBody(mapping))'],
  esWrite: ['internal/search/index.go', 'es.Index("<<table>>", bytes.NewReader(doc), es.Index.WithDocumentID(id))'],
  esRead: ['internal/search/query.go', 'es.Search(es.Search.WithIndex("<<table>>"), es.Search.WithBody(q))'],
  cacheWrite: ['internal/cache/quotes.go', 'rdb.Set(ctx, "<<name>>:"+symbol, b, 30*time.Second)'],
  cacheRead: ['internal/cache/quotes.go', 'rdb.Get(ctx, "<<name>>:"+symbol).Bytes()'],
  expose: ['internal/api/router.go', 'r.<<GoVerb>>("/<<handler>>", h.<<Handler>>)'],
  call: ['internal/client/<<targetShort>>.go', 'req, _ := http.NewRequest("<<method>>", c.base+"/<<handler>>", body)'],
  baseUrl: ['config/config.yaml', '<<targetShort>>_base_url: http://<<target>>:8080'],
  contract: ['go.mod', 'github.com/meridian/platform-events v<<version>>'],
  external: ['internal/feed/<<ext>>.go', 'const baseURL = "<<base>>"'],
}

const TYPESCRIPT = {
  topicConst: ['src/kafka/topics.ts', "export const <<CONST>> = '<<topic>>'"],
  produce: ['src/kafka/producer.ts', 'await producer.send({ topic: <<CONST>>, messages: [{ value: JSON.stringify(event) }] })'],
  consume: ['src/kafka/consumers/<<camelTopic>>.ts', 'await consumer.subscribe({ topic: <<CONST>>, fromBeginning: false })'],
  schema: ['src/kafka/producer.ts', 'const event: <<Event>> = toEvent(input)'],
  migration: ['migrations/0001_init.sql', 'CREATE TABLE <<table>> ('],
  dbWrite: ['src/db/<<camelTable>>.ts', "await sql`INSERT INTO <<table>> (id, updated_at) VALUES (${id}, now())`"],
  dbRead: ['src/db/<<camelTable>>.ts', "const rows = await sql`SELECT * FROM <<table>> WHERE id = ${id}`"],
  esOwns: ['src/search/bootstrap.ts', "await es.indices.create({ index: '<<table>>', mappings })"],
  esWrite: ['src/search/index.ts', "await es.index({ index: '<<table>>', id: doc.id, document: doc })"],
  esRead: ['src/search/query.ts', "const res = await es.search({ index: '<<table>>', query })"],
  cacheWrite: ['src/cache/<<camelName>>.ts', "await redis.set(`<<name>>:${key}`, value, 'EX', 1800)"],
  cacheRead: ['src/cache/<<camelName>>.ts', 'await redis.get(`<<name>>:${key}`)'],
  expose: ['src/api/<<camelHandler>>.ts', "router.<<lowerMethod>>('/<<handler>>', handler)"],
  call: ['src/clients/<<targetShort>>.ts', 'const res = await fetch(`${base}/<<handler>>`, { method: <<methodQ>> })'],
  baseUrl: ['src/config.ts', "<<targetShortCamel>>BaseUrl: process.env.<<TARGET_ENV>> ?? 'http://<<target>>:8080',"],
  contract: ['package.json', '"@meridian/platform-events": "<<version>>",'],
  external: ['src/providers/<<ext>>.ts', "const baseUrl = '<<base>>'"],
}

const PYTHON = {
  topicConst: ['app/kafka/topics.py', '<<CONST>> = "<<topic>>"'],
  produce: ['app/kafka/producer.py', 'producer.produce(<<CONST>>, key=key, value=json.dumps(event))'],
  consume: ['app/consumers/<<snakeTopic>>.py', 'consumer.subscribe([<<CONST>>])'],
  schema: ['app/kafka/producer.py', 'event = <<Event>>.model_validate(payload)'],
  migration: ['alembic/versions/0001_initial.py', 'op.create_table("<<table>>",'],
  dbWrite: ['app/db/warehouse.py', 'session.execute(text("INSERT INTO <<table>> (id, seen_at) VALUES (:id, :seen_at)"), row)'],
  dbRead: ['app/db/warehouse.py', 'session.execute(text("SELECT * FROM <<table>> WHERE seen_at > :since"), {"since": since})'],
  esOwns: ['app/search/bootstrap.py', 'es.indices.create(index="<<table>>", mappings=MAPPING, ignore=400)'],
  esWrite: ['app/search/index.py', 'es.index(index="<<table>>", id=doc["id"], document=doc)'],
  esRead: ['app/search/query.py', 'es.search(index="<<table>>", query=query, size=size)'],
  cacheWrite: ['app/cache/<<snakeName>>.py', 'redis.setex(f"<<name>>:{key}", 1800, value)'],
  cacheRead: ['app/cache/<<snakeName>>.py', 'redis.get(f"<<name>>:{key}")'],
  expose: ['app/api/<<snakeHandler>>.py', '@router.<<lowerMethod>>("/<<handler>>")'],
  call: ['app/clients/<<snakeTargetShort>>.py', 'resp = httpx.<<lowerMethod>>(f"{self.base}/<<handler>>", params=params)'],
  baseUrl: ['app/settings.py', '<<snakeTargetShort>>_base_url: str = "http://<<target>>:8080"'],
  contract: ['pyproject.toml', 'meridian-platform-events = "<<version>>"'],
  external: ['app/providers/<<ext>>.py', 'BASE_URL = "<<base>>"'],
}

const TEMPLATES = { kotlin: KOTLIN, java: JAVA, go: GO, typescript: TYPESCRIPT, python: PYTHON }

const VERB = { GET: 'Get', POST: 'Post', PUT: 'Put', PATCH: 'Patch', DELETE: 'Delete' }

/* ───────────────────────────────────────────────────────────── the builder */

function build(svc, index) {
  const tpl = TEMPLATES[svc.language]
  const nodes = new Map()
  const edges = []
  const unresolved = []

  // Distinct snippets walk down a file rather than all landing on line one;
  // the same snippet cited twice keeps the same line, because it is one line.
  const seen = new Map()
  const lineIn = (file, snippet) => {
    const key = `${file}|${snippet}`
    if (seen.has(key)) return seen.get(key)
    const n = [...seen.keys()].filter((k) => k.startsWith(`${file}|`)).length
    const base = file.endsWith('.sql') ? 1 : 6 + (hash(file) % 44)
    const line = base + n * (3 + (hash(`${file}#${n}`) % 9))
    seen.set(key, line)
    return line
  }

  const base = { pkg: svc.pkg, Class: svc.Class, repo: svc.repo }

  /** Render one template into an evidence entry. */
  const ev = (key, ctx) => {
    const [fileT, snippetT] = tpl[key]
    const full = { ...base, ...ctx }
    return cite(render(fileT, full), render(snippetT, full))
  }

  const cite = (file, snippet) => ({ file, line: lineIn(file, snippet), snippet })

  const node = (partial, evidence) => {
    const existing = nodes.get(partial.id)
    if (existing) {
      existing.evidence.push(...evidence)
      return existing
    }
    nodes.set(partial.id, { ...partial, evidence: [...evidence] })
    return nodes.get(partial.id)
  }

  const edge = (to, kind, extra, evidence) => {
    const row = { from: svc.id, to, kind, ...extra, confidence: extra.confidence ?? 'high', evidence }
    for (const k of Object.keys(row)) if (row[k] === undefined) delete row[k]
    edges.push(row)
  }

  const topicCtx = (t) => ({
    topic: t.name,
    CONST: constName(t.name),
    GoConst: goConst(t.name),
    camelTopic: camel(t.name.replace(/\.v\d+$/, '')),
    snakeTopic: snake(t.name.replace(/\.v\d+$/, '')),
    Event: t.contract ? eventClass(t.contract) : 'Event',
  })

  const topicNode = (t) => ({
    id: t.id,
    kind: 'kafka.topic',
    name: t.name,
    description: t.description,
  })

  /* topics this service produces */
  for (const t of TOPICS.filter((t) => t.producers.includes(svc.repo))) {
    const ctx = topicCtx(t)
    node(topicNode(t), [ev('topicConst', ctx)])
    const binds = (BINDINGS[svc.repo] ?? []).includes(t.contract)
    edge(
      t.id,
      'kafka.produce',
      {
        contract: binds ? t.contract : undefined,
        description: producePurpose(t, svc),
        // The call site names a constant, not the topic; the scan resolved it
        // one hop away in Topics. That is the schema's definition of medium.
        confidence: 'medium',
      },
      [ev('produce', ctx)]
    )
    if (binds) {
      edge(
        t.id,
        'topic.schema',
        { contract: t.contract, description: `${eventClass(t.contract)} is the payload on ${t.name}.` },
        [ev('schema', ctx)]
      )
    }
  }

  /* topics this service consumes */
  for (const t of TOPICS.filter((t) => t.consumers.includes(svc.repo))) {
    const ctx = topicCtx(t)
    node(topicNode(t), [ev('topicConst', ctx)])
    edge(
      t.id,
      'kafka.consume',
      {
        contract: (BINDINGS[svc.repo] ?? []).includes(t.contract) ? t.contract : undefined,
        description: consumePurpose(t, svc),
        confidence: 'medium',
      },
      [ev('consume', ctx)]
    )
  }

  /* the databases this repo holds the migrations for */
  for (const d of DATABASES.filter((d) => d.owner === svc.repo)) {
    const es = d.engine === 'elasticsearch'
    const ctx = { table: d.table, camelTable: camel(d.table), snakeTable: snake(d.table) }
    node(
      { id: d.id, kind: 'database', name: d.name, engine: d.engine, description: d.description },
      [ev(es ? 'esOwns' : 'migration', ctx)]
    )
    edge(d.id, 'db.owns', { description: `Holds the ${es ? 'index mappings' : 'migrations'} for ${d.name}.` }, [
      ev(es ? 'esOwns' : 'migration', ctx),
    ])
    edge(d.id, 'db.write', { description: `Writes ${d.table} as the owning service.` }, [ev(es ? 'esWrite' : 'dbWrite', ctx)])
    if (!es) edge(d.id, 'db.read', { description: `Reads ${d.table} to serve its own API.` }, [ev('dbRead', ctx)])
  }

  /* somebody else's database — each of these gets its own call site, because
     there are only two in the estate and both are the point */
  for (const a of DB_ACCESS.filter((a) => a.repo === svc.repo)) {
    const d = DATABASES.find((d) => d.id === a.db)
    node(
      { id: d.id, kind: 'database', name: d.name, engine: d.engine, description: d.description },
      [cite(a.access[0].file, a.access[0].snippet)]
    )
    for (const use of a.access) {
      edge(d.id, use.kind, { description: use.description }, [cite(use.file, use.snippet)])
    }
  }

  /* caches */
  for (const c of CACHES) {
    const access = c.access.find((a) => a.repo === svc.repo)
    if (!access) continue
    const ctx = { name: c.name, camelName: camel(c.name), snakeName: snake(c.name) }
    node(
      { id: c.id, kind: 'cache', name: c.name, engine: c.engine, description: c.description },
      [ev(access.kinds.includes('cache.write') ? 'cacheWrite' : 'cacheRead', ctx)]
    )
    for (const kind of access.kinds) {
      edge(c.id, kind, { description: access.description }, [
        ev(kind === 'cache.write' ? 'cacheWrite' : 'cacheRead', ctx),
      ])
    }
  }

  /* endpoints this service serves */
  for (const e of ENDPOINTS.filter((e) => e.exposedBy === svc.repo)) {
    const ctx = endpointCtx(e)
    node(
      { id: e.id, kind: 'endpoint', name: e.name, method: e.method, path: e.path, description: e.description },
      [ev('expose', ctx)]
    )
    edge(e.id, 'http.expose', { description: e.description }, [ev('expose', ctx)])
  }

  /* endpoints this service calls, and the service behind each one */
  for (const e of ENDPOINTS.filter((e) => e.calledBy.includes(svc.repo))) {
    const target = byRepo(e.exposedBy)
    const ctx = { ...endpointCtx(e), target: target.repo, targetShort: shortRepo(target.repo), TargetClass: target.Class }
    node(
      { id: e.id, kind: 'endpoint', name: e.name, method: e.method, path: e.path },
      [ev('call', ctx)]
    )
    node({ id: target.id, kind: 'service', name: target.name }, [
      ev('baseUrl', {
        ...ctx,
        targetShortCamel: camel(shortRepo(target.repo)),
        snakeTargetShort: snake(shortRepo(target.repo)),
        TARGET_ENV: `${snake(shortRepo(target.repo)).toUpperCase()}_BASE_URL`,
      }),
    ])
    edge(e.id, 'http.call', { description: e.purpose }, [ev('call', ctx)])
  }

  /* the shared event library, and the version this repo pins */
  for (const contractId of BINDINGS[svc.repo] ?? []) {
    const c = CONTRACTS.find((c) => c.id === contractId)
    const version = VERSION(svc.repo)
    const evidence = [ev('contract', { version })]
    node(
      {
        id: c.id,
        kind: 'contract',
        name: c.name,
        contractType: 'class',
        version,
        description: c.description,
      },
      evidence
    )
    edge(c.id, 'depends.on', { description: `Binds ${c.name} at ${version}.` }, [ev('contract', { version })])
  }

  /* third parties */
  for (const x of EXTERNALS.filter((x) => x.repo === svc.repo)) {
    const ctx = { ext: x.id.slice(4), Ext: pascal(x.id.slice(4)), base: x.base }
    node({ id: x.id, kind: 'external', name: x.name, description: x.description }, [ev('external', ctx)])
    edge(x.id, 'http.call', { description: x.purpose }, [ev('external', ctx)])
  }

  /* what the scan could see happening and could not pin down */
  for (const u of UNRESOLVED[svc.repo] ?? []) {
    unresolved.push({
      expected: u.expected,
      raw: u.raw,
      reason: u.reason,
      evidence: [cite(u.file, u.snippet)],
    })
  }

  return {
    schemaVersion: 1,
    promptVersion: PROMPT_VERSION,
    repo: svc.repo,
    commit: commitFor(svc.repo),
    branch: 'main',
    scannedAt: scannedAt(index),
    // Honest about its own provenance: these manifests come out of the
    // generator in this repository, not out of a scan of anything.
    producer: { kind: 'parser', tool: 'seed-demo/1' },
    service: {
      id: svc.id,
      name: svc.name,
      language: svc.language,
      team: svc.team,
      description: svc.description,
      ...(svc.tags ? { tags: svc.tags } : {}),
    },
    nodes: [...nodes.values()],
    edges,
    unresolved,
  }
}

function endpointCtx(e) {
  // The handler's name is what a developer would call the function: the path
  // without its version prefix or its placeholders. `/v1/wallets/{id}/balance`
  // is handled by something called walletsBalance, not by v1Wallets.
  const words = e.handler
    .split('/')
    .filter((seg) => seg && !/^v\d+$/.test(seg) && !seg.startsWith('{'))
  return {
    handler: e.handler,
    method: e.method,
    methodQ: `'${e.method}'`,
    lowerMethod: e.method.toLowerCase(),
    Verb: VERB[e.method],
    GoVerb: VERB[e.method],
    Handler: words.map(pascal).join(''),
    camelHandler: camel(words.join('-')),
    snakeHandler: words.join('_'),
  }
}

/** One sentence in business terms, per §12's relationships. */
function producePurpose(t, svc) {
  return {
    'topic:users.created.v2': 'Announces a new customer so wallets, payment profiles and the welcome mail can follow.',
    'topic:kyc.approved.v1': 'Announces that a customer has passed verification and may now trade.',
    'topic:orders.placed.v1': 'Hands a validated order to the matching engine.',
    'topic:orders.matched.v1': 'Publishes a fill so the ledger can post it and reporting can count it.',
    'topic:wallet.balance.changed.v1': 'Publishes a balance movement so the customer can be told and the warehouse updated.',
    'topic:payments.settled.v1': 'Publishes a cleared payment so the ledger can post it.',
    'topic:prices.ticked.v1': 'Publishes the reference price tick the book and the warehouse run on.',
    'topic:notifications.requested.v1': `Asks for a customer notification that no domain event from ${svc.name.toLowerCase()} covers.`,
  }[t.id]
}

function consumePurpose(t, svc) {
  return {
    'svc:wallet-service|topic:users.created.v2': 'Opens the customer wallets as soon as the account exists.',
    'svc:payments-service|topic:users.created.v2': 'Creates a payment profile when a new customer is onboarded.',
    'svc:notification-service|topic:users.created.v2': 'Sends the welcome mail.',
    'svc:wallet-service|topic:kyc.approved.v1': 'Lifts the withdrawal hold once the customer is verified.',
    'svc:order-service|topic:kyc.approved.v1': 'Allows the customer to place orders once verified.',
    'svc:matching-engine|topic:orders.placed.v1': 'Takes admitted orders into the book.',
    'svc:ledger-service|topic:orders.matched.v1': 'Posts both sides of the fill to the customer accounts.',
    'svc:reporting-service|topic:orders.matched.v1': 'Loads fills into the trade warehouse.',
    'svc:notification-service|topic:wallet.balance.changed.v1': 'Tells the customer their balance moved.',
    'svc:reporting-service|topic:wallet.balance.changed.v1': 'Keeps the balance history the statements are built from.',
    'svc:ledger-service|topic:payments.settled.v1': 'Posts the cleared payment against the customer account.',
    'svc:matching-engine|topic:prices.ticked.v1': 'Keeps the reference price the book validates limit orders against.',
    'svc:reporting-service|topic:prices.ticked.v1': 'Stores the price series trades are valued against.',
    'svc:notification-service|topic:notifications.requested.v1': 'Renders and sends whatever the requesting service asked for.',
    'svc:ledger-service|topic:risk.flagged.v1': 'Holds postings for any transaction the risk platform has flagged.',
  }[`${svc.id}|${t.id}`]
}

export function buildManifests() {
  return SERVICES.map((svc, i) => build(svc, i))
}
