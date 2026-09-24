package com.coopcompass;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;

public final class ApplicationServer {
    private static final int MAX_REQUEST_BYTES = 64 * 1024;
    private static final String CONTENT_SECURITY_POLICY = "default-src 'self'; script-src 'self' 'sha256-48D3gRF3fp2g7CI15bz3WUDeNsrYv/Zo28KQ02ZrUXQ='; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
    private final ApplicationRepository repository;
    private final Path publicDirectory;

    private ApplicationServer(ApplicationRepository repository, Path publicDirectory) {
        this.repository = repository;
        this.publicDirectory = publicDirectory;
    }

    public static void main(String[] args) throws IOException {
        int port = args.length > 0 ? Integer.parseInt(args[0]) : 8080;
        HttpServer server = createServer(
                Path.of("data", "applications.tsv"),
                Path.of("src", "main", "resources", "public"),
                new InetSocketAddress(InetAddress.getLoopbackAddress(), port),
                Executors.newFixedThreadPool(8));
        server.start();
        System.out.println("My Internship Notebook is running at http://localhost:" + port);
    }

    static HttpServer createServer(Path dataFile, Path publicDirectory, InetSocketAddress address, Executor executor) throws IOException {
        ApplicationRepository repository = new ApplicationRepository(dataFile);
        ApplicationServer app = new ApplicationServer(repository, publicDirectory.toAbsolutePath().normalize());
        HttpServer server = HttpServer.create(address, 0);
        server.createContext("/api/applications", app::applications);
        server.createContext("/api/recently-deleted", app::recentlyDeleted);
        server.createContext("/api/dashboard", app::dashboard);
        server.createContext("/", app::staticFile);
        server.setExecutor(executor);
        return server;
    }

    private void applications(HttpExchange exchange) throws IOException {
        if (!allowApiRequest(exchange)) return;
        try {
            String method = exchange.getRequestMethod();
            String path = exchange.getRequestURI().getPath();
            if ("GET".equals(method) && "/api/applications".equals(path)) {
                respondJson(exchange, 200, "[" + repository.list().stream().map(this::applicationJson).reduce((left, right) -> left + "," + right).orElse("") + "]");
                return;
            }
            if ("POST".equals(method) && "/api/applications/bulk-status".equals(path)) {
                String body = readBody(exchange);
                List<Long> ids = Json.longArray(body, "ids");
                String status = Json.string(body, "status").orElseThrow(() -> new IllegalArgumentException("status is required."));
                List<Application> updated = repository.updateStatuses(ids, status)
                        .orElseThrow(() -> new NotFoundException("One or more active applications were not found."));
                respondJson(exchange, 200, applicationsJson(updated));
                return;
            }
            if ("POST".equals(method) && "/api/applications/bulk-delete".equals(path)) {
                List<Long> ids = Json.longArray(readBody(exchange), "ids");
                List<ApplicationRepository.DeletedApplication> deleted = repository.deleteAll(ids)
                        .orElseThrow(() -> new NotFoundException("One or more active applications were not found."));
                respondJson(exchange, 200, deletedApplicationsJson(deleted));
                return;
            }
            if ("POST".equals(method) && "/api/applications".equals(path)) {
                Application created = repository.create(payload(readBody(exchange)));
                respondJson(exchange, 201, applicationJson(created));
                return;
            }
            long id = idFrom(path);
            if ("PATCH".equals(method) && id > 0) {
                // Accepts any subset of fields: {"status":"APPLIED"} still works, and the notebook page sends edits.
                Application application = repository.update(id, payload(readBody(exchange)))
                        .orElseThrow(() -> new NotFoundException("Application not found."));
                respondJson(exchange, 200, applicationJson(application));
                return;
            }
            if ("DELETE".equals(method) && id > 0) {
                if (!repository.delete(id)) throw new NotFoundException("Application not found.");
                respondNoContent(exchange);
                return;
            }
            respondJson(exchange, 405, error("Method or endpoint not supported."));
        } catch (HttpException exception) {
            respondJson(exchange, exception.status, error(exception.getMessage()));
        } catch (NotFoundException exception) {
            respondJson(exchange, 404, error(exception.getMessage()));
        } catch (IllegalArgumentException exception) {
            respondJson(exchange, 400, error(exception.getMessage()));
        } catch (Exception exception) {
            exception.printStackTrace();
            respondJson(exchange, 500, error("Something went wrong. Try again."));
        }
    }

    private void dashboard(HttpExchange exchange) throws IOException {
        if (!allowApiRequest(exchange)) return;
        if (!"GET".equals(exchange.getRequestMethod())) {
            respondJson(exchange, 405, error("Method not supported."));
            return;
        }
        ApplicationRepository.Dashboard dashboard = repository.dashboard();
        String statuses = dashboard.byStatus().entrySet().stream()
                .map(entry -> "\"" + entry.getKey().name() + "\":" + entry.getValue())
                .reduce((left, right) -> left + "," + right).orElse("");
        respondJson(exchange, 200, "{\"total\":" + dashboard.total() + ",\"responseRate\":" + dashboard.responseRate() + ",\"byStatus\":{" + statuses + "}}");
    }

    private void recentlyDeleted(HttpExchange exchange) throws IOException {
        if (!allowApiRequest(exchange)) return;
        try {
            String method = exchange.getRequestMethod();
            String path = exchange.getRequestURI().getPath();
            if ("GET".equals(method) && "/api/recently-deleted".equals(path)) {
                String applications = repository.recentlyDeleted().stream()
                        .map(this::deletedApplicationJson)
                        .reduce((left, right) -> left + "," + right)
                        .orElse("");
                respondJson(exchange, 200, "[" + applications + "]");
                return;
            }
            if ("POST".equals(method) && "/api/recently-deleted/bulk-restore".equals(path)) {
                List<Long> ids = Json.longArray(readBody(exchange), "ids");
                List<Application> restored = repository.restoreAll(ids)
                        .orElseThrow(() -> new NotFoundException("One or more Recently Deleted applications were not found."));
                respondJson(exchange, 200, applicationsJson(restored));
                return;
            }
            if ("POST".equals(method) && "/api/recently-deleted/bulk-permanent-delete".equals(path)) {
                List<Long> ids = Json.longArray(readBody(exchange), "ids");
                List<ApplicationRepository.DeletedApplication> deleted = repository.permanentlyDeleteAll(ids)
                        .orElseThrow(() -> new NotFoundException("One or more Recently Deleted applications were not found."));
                respondJson(exchange, 200, deletedApplicationsJson(deleted));
                return;
            }

            String restoreSuffix = "/restore";
            if ("POST".equals(method) && path.endsWith(restoreSuffix)) {
                long id = idFrom(path.substring(0, path.length() - restoreSuffix.length()), "/api/recently-deleted/");
                if (id <= 0) {
                    respondJson(exchange, 405, error("Method or endpoint not supported."));
                    return;
                }
                Application restored = repository.restore(id).orElseThrow(() -> new NotFoundException("Recently deleted application not found."));
                respondJson(exchange, 200, applicationJson(restored));
                return;
            }

            long id = idFrom(path, "/api/recently-deleted/");
            if ("DELETE".equals(method) && id > 0) {
                if (!repository.permanentlyDelete(id)) throw new NotFoundException("Recently deleted application not found.");
                respondNoContent(exchange);
                return;
            }
            respondJson(exchange, 405, error("Method or endpoint not supported."));
        } catch (HttpException exception) {
            respondJson(exchange, exception.status, error(exception.getMessage()));
        } catch (NotFoundException exception) {
            respondJson(exchange, 404, error(exception.getMessage()));
        } catch (IllegalArgumentException exception) {
            respondJson(exchange, 400, error(exception.getMessage()));
        } catch (Exception exception) {
            exception.printStackTrace();
            respondJson(exchange, 500, error("Something went wrong. Try again."));
        }
    }

    private void staticFile(HttpExchange exchange) throws IOException {
        securityHeaders(exchange);
        if (!"GET".equals(exchange.getRequestMethod())) {
            exchange.sendResponseHeaders(405, -1);
            exchange.close();
            return;
        }
        String requested = exchange.getRequestURI().getPath();
        String relative = requested.equals("/") ? "index.html" : requested.substring(1);
        Path file = publicDirectory.resolve(relative).normalize();
        if (!file.startsWith(publicDirectory) || !Files.isRegularFile(file)) {
            exchange.sendResponseHeaders(404, -1);
            exchange.close();
            return;
        }
        byte[] content = Files.readAllBytes(file);
        exchange.getResponseHeaders().set("Content-Type", contentType(file));
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        exchange.sendResponseHeaders(200, content.length);
        exchange.getResponseBody().write(content);
        exchange.close();
    }

    private Map<String, String> payload(String body) {
        Map<String, String> values = new LinkedHashMap<>();
        for (String field : new String[]{"company", "role", "location", "source", "status", "deadline", "notes", "skills",
                "link", "contact", "nextStep", "nextStepDate"}) {
            Json.string(body, field).ifPresent(value -> values.put(field, value));
        }
        Json.bool(body, "starred").ifPresent(value -> values.put("starred", Boolean.toString(value)));
        return values;
    }

    private long idFrom(String path) {
        return idFrom(path, "/api/applications/");
    }

    private long idFrom(String path, String prefix) {
        if (!path.startsWith(prefix)) return -1;
        try { return Long.parseLong(path.substring(prefix.length())); }
        catch (NumberFormatException exception) { return -1; }
    }

    private String applicationJson(Application application) {
        return applicationJson(application, null);
    }

    private String deletedApplicationJson(ApplicationRepository.DeletedApplication deleted) {
        return applicationJson(deleted.application(), deleted.deletedAt());
    }

    private String applicationsJson(List<Application> applications) {
        return "[" + applications.stream().map(this::applicationJson).reduce((left, right) -> left + "," + right).orElse("") + "]";
    }

    private String deletedApplicationsJson(List<ApplicationRepository.DeletedApplication> deleted) {
        return "[" + deleted.stream().map(this::deletedApplicationJson).reduce((left, right) -> left + "," + right).orElse("") + "]";
    }

    private String applicationJson(Application application, java.time.Instant deletedAt) {
        return "{\"id\":" + application.id()
                + ",\"company\":\"" + Json.escape(application.company()) + "\""
                + ",\"role\":\"" + Json.escape(application.role()) + "\""
                + ",\"location\":\"" + Json.escape(application.location()) + "\""
                + ",\"source\":\"" + Json.escape(application.source()) + "\""
                + ",\"status\":\"" + application.status().name() + "\""
                + ",\"deadline\":\"" + application.deadline() + "\""
                + ",\"notes\":\"" + Json.escape(application.notes()) + "\""
                + ",\"skills\":[" + application.skills().stream().map(skill -> "\"" + Json.escape(skill) + "\"").reduce((left, right) -> left + "," + right).orElse("") + "]"
                + ",\"createdAt\":\"" + DateTimeFormatter.ISO_INSTANT.format(application.createdAt()) + "\""
                + ",\"updatedAt\":\"" + DateTimeFormatter.ISO_INSTANT.format(application.updatedAt()) + "\""
                + ",\"link\":\"" + Json.escape(application.link()) + "\""
                + ",\"contact\":\"" + Json.escape(application.contact()) + "\""
                + ",\"nextStep\":\"" + Json.escape(application.nextStep()) + "\""
                + ",\"nextStepDate\":\"" + application.nextStepDate() + "\""
                + ",\"starred\":" + application.starred()
                + ",\"history\":[" + application.history().stream()
                        .map(change -> "{\"status\":\"" + change.status().name() + "\",\"at\":\""
                                + DateTimeFormatter.ISO_INSTANT.format(change.at()) + "\"}")
                        .reduce((left, right) -> left + "," + right).orElse("") + "]"
                + (deletedAt == null ? "" : ",\"deletedAt\":\"" + DateTimeFormatter.ISO_INSTANT.format(deletedAt) + "\"")
                + "}";
    }

    private static String readBody(HttpExchange exchange) throws IOException {
        byte[] content = exchange.getRequestBody().readNBytes(MAX_REQUEST_BYTES + 1);
        if (content.length > MAX_REQUEST_BYTES) throw new HttpException(413, "Request body is too large.");
        return new String(content, StandardCharsets.UTF_8);
    }

    private static void respondJson(HttpExchange exchange, int status, String json) throws IOException {
        securityHeaders(exchange);
        byte[] content = json.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        exchange.sendResponseHeaders(status, content.length);
        exchange.getResponseBody().write(content);
        exchange.close();
    }

    private static void respondNoContent(HttpExchange exchange) throws IOException {
        securityHeaders(exchange);
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        exchange.sendResponseHeaders(204, -1);
        exchange.close();
    }

    private static void securityHeaders(HttpExchange exchange) {
        exchange.getResponseHeaders().set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
        exchange.getResponseHeaders().set("Cross-Origin-Opener-Policy", "same-origin");
        exchange.getResponseHeaders().set("Cross-Origin-Resource-Policy", "same-origin");
        exchange.getResponseHeaders().set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
        exchange.getResponseHeaders().set("Referrer-Policy", "no-referrer");
        exchange.getResponseHeaders().set("X-Content-Type-Options", "nosniff");
        exchange.getResponseHeaders().set("X-Frame-Options", "DENY");
    }

    private static boolean allowApiRequest(HttpExchange exchange) throws IOException {
        String fetchSite = exchange.getRequestHeaders().getFirst("Sec-Fetch-Site");
        String origin = exchange.getRequestHeaders().getFirst("Origin");
        if ("cross-site".equalsIgnoreCase(fetchSite)
                || (origin != null && !origin.isBlank() && !isLocalOrigin(origin, exchange.getLocalAddress().getPort()))) {
            respondJson(exchange, 403, error("Cross-site API requests are not allowed."));
            return false;
        }

        String method = exchange.getRequestMethod();
        if (List.of("POST", "PATCH", "PUT").contains(method)) {
            String contentType = exchange.getRequestHeaders().getFirst("Content-Type");
            String mediaType = contentType == null ? "" : contentType.split(";", 2)[0].trim();
            if (!mediaType.equalsIgnoreCase("application/json")) {
                respondJson(exchange, 415, error("Content-Type must be application/json."));
                return false;
            }
        }
        return true;
    }

    private static boolean isLocalOrigin(String value, int serverPort) {
        try {
            URI origin = URI.create(value);
            String host = origin.getHost();
            int port = origin.getPort() < 0 ? 80 : origin.getPort();
            return "http".equalsIgnoreCase(origin.getScheme())
                    && port == serverPort
                    && host != null
                    && (host.equalsIgnoreCase("localhost") || host.equals("127.0.0.1") || host.equals("::1"));
        } catch (IllegalArgumentException exception) {
            return false;
        }
    }

    private static String error(String message) { return "{\"error\":\"" + Json.escape(message) + "\"}"; }

    private static String contentType(Path file) {
        return switch (file.getFileName().toString().substring(file.getFileName().toString().lastIndexOf('.') + 1)) {
            case "css" -> "text/css; charset=utf-8";
            case "js" -> "application/javascript; charset=utf-8";
            case "svg" -> "image/svg+xml";
            case "png" -> "image/png";
            case "ico" -> "image/x-icon";
            case "json" -> "application/json; charset=utf-8";
            case "webmanifest" -> "application/manifest+json; charset=utf-8";
            case "txt" -> "text/plain; charset=utf-8";
            case "xml" -> "application/xml; charset=utf-8";
            default -> "text/html; charset=utf-8";
        };
    }

    private static final class NotFoundException extends RuntimeException {
        private NotFoundException(String message) { super(message); }
    }

    private static final class HttpException extends IllegalArgumentException {
        private final int status;

        private HttpException(int status, String message) {
            super(message);
            this.status = status;
        }
    }
}
