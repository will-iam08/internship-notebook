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

public final class ApplicationServerSecurityTest {
    public static void main(String[] args) throws Exception {
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
