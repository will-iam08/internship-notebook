package com.coopcompass;

import com.sun.net.httpserver.HttpServer;

import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;

public final class ApplicationServerSecurityTest {
    public static void main(String[] args) throws Exception {
        jsonEscapesAndArraysAreValidated();
        Path directory = Files.createTempDirectory("coop-compass-server-test-");
        Path publicDirectory = Path.of("src", "main", "resources", "public");
        HttpServer server = ApplicationServer.createServer(
                directory.resolve("applications.tsv"),
                publicDirectory,
                new InetSocketAddress(InetAddress.getLoopbackAddress(), 0),
                Runnable::run);
        server.start();

        try {
            int port = server.getAddress().getPort();
            URI base = URI.create("http://localhost:" + port);
            HttpClient client = HttpClient.newHttpClient();

            HttpResponse<String> page = client.send(
                    HttpRequest.newBuilder(base.resolve("/")).GET().build(),
                    HttpResponse.BodyHandlers.ofString());
            assert page.statusCode() == 200;
            assert page.headers().firstValue("Content-Security-Policy").orElse("").contains("default-src 'self'");
            assert page.headers().firstValue("X-Content-Type-Options").orElse("").equals("nosniff");
            assert page.headers().firstValue("X-Frame-Options").orElse("").equals("DENY");

            String validBody = "{\"company\":\"Acme\",\"role\":\"Intern\"}";
            HttpResponse<String> created = sendJson(client, base.resolve("/api/applications"), validBody, base.toString());
            assert created.statusCode() == 201;

            HttpResponse<String> crossSite = sendJson(client, base.resolve("/api/applications"), validBody, "https://attacker.example");
            assert crossSite.statusCode() == 403;

            HttpResponse<String> wrongType = client.send(
                    HttpRequest.newBuilder(base.resolve("/api/applications"))
                            .header("Content-Type", "application/jsonp")
                            .header("Origin", base.toString())
                            .POST(HttpRequest.BodyPublishers.ofString(validBody))
                            .build(),
                    HttpResponse.BodyHandlers.ofString());
            assert wrongType.statusCode() == 415;

            HttpResponse<String> tooLarge = sendJson(
                    client,
                    base.resolve("/api/applications"),
                    "{\"company\":\"" + "x".repeat(70_000) + "\",\"role\":\"Intern\"}",
                    base.toString());
            assert tooLarge.statusCode() == 413;

            backupsImportAtomically(client, base, directory.resolve("applications.tsv"));

            HttpResponse<String> applications = client.send(
                    HttpRequest.newBuilder(base.resolve("/api/applications")).GET().build(),
                    HttpResponse.BodyHandlers.ofString());
            assert applications.statusCode() == 200;
            assert applications.body().contains("\"company\":\"Acme\"");
            assert !applications.body().contains("attacker.example");
        } finally {
            server.stop(0);
        }

        System.out.println("ApplicationServerSecurityTest passed");
    }

    private static void jsonEscapesAndArraysAreValidated() {
        String slash = String.valueOf((char) 92);
        String unicode = "{\"company\":\"" + slash + "u0041cme " + slash + "u6771" + slash + "u4eac "
                + slash + "ud83d" + slash + "ude00\"}";
        assert Json.string(unicode, "company").orElseThrow().equals("Acme 東京 😀");
        String original = "Quoted \"text\", slash \\ /, backspace\b formfeed\f newline\n return\r tab\t " + (char) 0 + (char) 0xd800;
        assert Json.string("{\"text\":\"" + Json.escape(original) + "\"}", "text").orElseThrow().equals(original);
        String row = "{\"company\":\"Acme\",\"notes\":\"" + Json.escape("{braces} [array], \"quote\", \\ slash") + "\"}";
        assert Json.objectArray("{\"applications\":[" + row + "]}", "applications").size() == 1;
        assert Json.string("{\"nested\":{\"company\":\"Hidden\"}}", "company").isEmpty();
        assert Json.longArray("{\"ids\":[1,2,3]}", "ids").equals(java.util.List.of(1L, 2L, 3L));
        for (String escape : java.util.List.of("q", "u12", "uZZZZ")) {
            assertInvalidJson(() -> Json.string("{\"text\":\"" + slash + escape + "\"}", "text"));
        }
        assertInvalidJson(() -> Json.string("{\"text\":\"raw\nnewline\"}", "text"));
        assertInvalidJson(() -> Json.string("{\"text\":\"a\",\"text\":\"b\"}", "text"));
        assertInvalidJson(() -> Json.objectArray("{\"applications\":[" + row + ",]}", "applications"));
        assertInvalidJson(() -> Json.objectArray("{\"applications\":[{\"company\":{\"nested\":\"Acme\"}}]}", "applications"));
        assertInvalidJson(() -> Json.longArray("{\"ids\":[1,2,]}", "ids"));
        assertInvalidJson(() -> Json.longArray("{\"ids\":[1.5]}", "ids"));
    }

    private static void assertInvalidJson(Runnable action) {
        try {
            action.run();
            throw new AssertionError("Expected invalid JSON to be rejected");
        } catch (IllegalArgumentException expected) {
            // Invalid input must fail before the repository changes.
        }
    }

    private static void backupsImportAtomically(HttpClient client, URI base, Path file) throws Exception {
        String createdAt = "2025-09-01T10:00:00Z";
        String updatedAt = "2025-09-02T10:00:00Z";
        String deletedAt = Instant.now().minusSeconds(3600).toString();
        String notes = "Prepare {a portfolio}, [questions], and \"examples\".";
        String active = "{\"id\":1,\"company\":\"Imported Co\",\"role\":\"Intern\",\"status\":\"APPLIED\","
                + "\"createdAt\":\"" + createdAt + "\",\"updatedAt\":\"" + updatedAt + "\","
                + "\"history\":\"SAVED@" + createdAt + ";APPLIED@" + updatedAt + "\","
                + "\"skills\":\"Java, SQL\",\"notes\":\"" + Json.escape(notes) + "\"}";
        String deleted = active.replace("Imported Co", "Deleted Co").replace("\"id\":1,", "\"deletedAt\":\"" + deletedAt + "\",");
        String backup = "{\"applications\":[" + active + "],\"recentlyDeleted\":[" + deleted + "]}";
        HttpResponse<String> imported = sendJson(client, base.resolve("/api/applications/import"), backup, base.toString());
        assert imported.statusCode() == 200 : imported.body();
        assert imported.body().contains("\"applications\":[{\"id\":2");
        assert imported.body().contains("\"recentlyDeleted\":[{\"id\":3");
        assert imported.body().contains("\"createdAt\":\"" + createdAt + "\"");
        assert imported.body().contains("\"updatedAt\":\"" + updatedAt + "\"");
        assert imported.body().contains("\"deletedAt\":\"" + deletedAt + "\"");
        assert imported.body().contains("\"history\":[{\"status\":\"SAVED\",\"at\":\"" + createdAt + "\"}");
        assert imported.body().contains("\"notes\":\"" + Json.escape(notes) + "\"");
        HttpResponse<String> duplicate = sendJson(client, base.resolve("/api/applications/import"), backup, base.toString());
        assert duplicate.statusCode() == 200;
        assert duplicate.body().equals("{\"applications\":[],\"recentlyDeleted\":[]}");

        byte[] before = Files.readAllBytes(file);
        String invalid = "{\"applications\":[" + active.replace("Imported Co", "New Co") + ","
                + "{\"company\":\"Broken Co\",\"role\":\"Intern\",\"history\":\"APPLIED@bad-time\"}],\"recentlyDeleted\":[]}";
        assert sendJson(client, base.resolve("/api/applications/import"), invalid, base.toString()).statusCode() == 400;
        assert java.util.Arrays.equals(before, Files.readAllBytes(file));

        String large = java.util.stream.IntStream.range(0, 8)
                .mapToObj(index -> "{\"company\":\"Bulk " + index + "\",\"role\":\"Intern\",\"notes\":\"" + "x".repeat(9000) + "\"}")
                .collect(java.util.stream.Collectors.joining(","));
        assert sendJson(client, base.resolve("/api/applications/import"),
                "{\"applications\":[" + large + "],\"recentlyDeleted\":[]}", base.toString()).statusCode() == 200;
        assert sendJson(client, base.resolve("/api/applications/import"),
                "{\"applications\":[],\"padding\":\"" + "x".repeat(5 * 1024 * 1024) + "\"}", base.toString()).statusCode() == 413;
    }

    private static HttpResponse<String> sendJson(HttpClient client, URI uri, String body, String origin) throws Exception {
        return client.send(
                HttpRequest.newBuilder(uri)
                        .header("Content-Type", "application/json")
                        .header("Origin", origin)
                        .POST(HttpRequest.BodyPublishers.ofString(body))
                        .build(),
                HttpResponse.BodyHandlers.ofString());
    }
}
