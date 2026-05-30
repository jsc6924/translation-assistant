using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Tasks;
using editor.Models;

namespace editor.Services;

public sealed class SimpleTmRemoteClient
{
    private sealed class SharedConnection
    {
        public required string BaseUrl { get; init; }

        public required string Username { get; init; }

        public required string ApiToken { get; init; }

        public required string GameTitle { get; init; }
    }

    private sealed class DictEntryDto
    {
        [JsonPropertyName("raw")]
        public string Raw { get; set; } = string.Empty;

        [JsonPropertyName("translate")]
        public string Translate { get; set; } = string.Empty;

        [JsonPropertyName("comment")]
        public string? Comment { get; set; }
    }

    public async Task<(IReadOnlyList<TerminologyEntry> Terms, IReadOnlyDictionary<string, IReadOnlyDictionary<string, NamingRuleValue>> NamingRules)> FetchAsync(string sharedUrl)
    {
        var connection = ParseSharedUrl(sharedUrl);
        using var httpClient = CreateHttpClient(connection);

        var terms = await FetchTermsAsync(httpClient, connection).ConfigureAwait(false);
        var naming = await FetchNamingRulesAsync(httpClient, connection).ConfigureAwait(false);
        return (terms, naming);
    }

    public async Task<string> FetchTermsJsonAsync(string sharedUrl)
    {
        var connection = ParseSharedUrl(sharedUrl);
        using var httpClient = CreateHttpClient(connection);

        return await httpClient.GetStringAsync(BuildUrl(connection.BaseUrl, $"/api/querybygame/{Uri.EscapeDataString(connection.GameTitle)}")).ConfigureAwait(false);
    }

    public async Task<string> FetchVscodeConfigJsonAsync(string sharedUrl)
    {
        var connection = ParseSharedUrl(sharedUrl);
        using var httpClient = CreateHttpClient(connection);

        return await httpClient.GetStringAsync(BuildUrl(connection.BaseUrl, $"/api2/vscodeConfig/{Uri.EscapeDataString(connection.GameTitle)}")).ConfigureAwait(false);
    }

    private static HttpClient CreateHttpClient(SharedConnection connection)
    {
        var httpClient = new HttpClient();
        httpClient.Timeout = TimeSpan.FromSeconds(15);
        var authValue = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{connection.Username}:{connection.ApiToken}"));
        httpClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Basic", authValue);
        return httpClient;
    }

    private static async Task<IReadOnlyList<TerminologyEntry>> FetchTermsAsync(HttpClient httpClient, SharedConnection connection)
    {
        var url = BuildUrl(connection.BaseUrl, $"/api/querybygame/{Uri.EscapeDataString(connection.GameTitle)}");
        var json = await httpClient.GetStringAsync(url).ConfigureAwait(false);
        var entries = JsonSerializer.Deserialize<List<DictEntryDto>>(json) ?? [];
        var result = new List<TerminologyEntry>(entries.Count);
        foreach (var entry in entries)
        {
            if (string.IsNullOrWhiteSpace(entry.Raw))
            {
                continue;
            }

            result.Add(new TerminologyEntry
            {
                Raw = entry.Raw,
                Translation = entry.Translate ?? string.Empty,
                Comment = entry.Comment,
            });
        }

        return result;
    }

    private static async Task<IReadOnlyDictionary<string, IReadOnlyDictionary<string, NamingRuleValue>>> FetchNamingRulesAsync(HttpClient httpClient, SharedConnection connection)
    {
        var url = BuildUrl(connection.BaseUrl, $"/api2/naming/{Uri.EscapeDataString(connection.GameTitle)}");
        var json = await httpClient.GetStringAsync(url).ConfigureAwait(false);

        using var document = JsonDocument.Parse(json);
        if (!document.RootElement.TryGetProperty("rules", out var rulesElement) || rulesElement.ValueKind != JsonValueKind.Object)
        {
            return new Dictionary<string, IReadOnlyDictionary<string, NamingRuleValue>>();
        }

        var result = new Dictionary<string, IReadOnlyDictionary<string, NamingRuleValue>>(StringComparer.Ordinal);
        foreach (var callerProperty in rulesElement.EnumerateObject())
        {
            if (callerProperty.Value.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            var calledRules = new Dictionary<string, NamingRuleValue>(StringComparer.Ordinal);
            foreach (var calledProperty in callerProperty.Value.EnumerateObject())
            {
                var value = ParseNamingRuleValue(calledProperty.Value);
                calledRules[calledProperty.Name] = value;
            }

            result[callerProperty.Name] = calledRules;
        }

        return result;
    }

    private static NamingRuleValue ParseNamingRuleValue(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.String)
        {
            return new NamingRuleValue
            {
                Transcaller = element.GetString() ?? string.Empty,
            };
        }

        if (element.ValueKind == JsonValueKind.Object)
        {
            var transcaller = element.TryGetProperty("transcaller", out var transcallerElement)
                ? transcallerElement.GetString() ?? string.Empty
                : string.Empty;
            var comment = element.TryGetProperty("comment", out var commentElement)
                ? commentElement.GetString()
                : null;
            return new NamingRuleValue
            {
                Transcaller = transcaller,
                Comment = comment,
            };
        }

        return new NamingRuleValue();
    }

    private static SharedConnection ParseSharedUrl(string sharedUrl)
    {
        if (string.IsNullOrWhiteSpace(sharedUrl) || !sharedUrl.StartsWith("simpletm://", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("SimpleTM shared URL 格式无效。请使用 simpletm://...。");
        }

        var body = sharedUrl["simpletm://".Length..];
        var parts = body.Split('/', StringSplitOptions.None);
        if (parts.Length != 5)
        {
            throw new InvalidOperationException("SimpleTM shared URL 格式无效。期望 5 段路径信息。");
        }

        return new SharedConnection
        {
            BaseUrl = $"{parts[0]}://{parts[1]}",
            Username = parts[2],
            ApiToken = parts[3],
            GameTitle = parts[4],
        };
    }

    public async Task<bool> UpdateTermAsync(string sharedUrl, string rawText, string translation)
    {
        var connection = ParseSharedUrl(sharedUrl);
        using var httpClient = CreateHttpClient(connection);

        var url = BuildUrl(connection.BaseUrl, "/api2/update");
        var body = new
        {
            game = connection.GameTitle,
            rawWord = rawText,
            translate = translation,
        };

        return await SendTermUpdateRequestAsync(httpClient, url, body).ConfigureAwait(false);
    }

    public async Task<bool> DeleteTermAsync(string sharedUrl, string rawText)
    {
        var connection = ParseSharedUrl(sharedUrl);
        using var httpClient = CreateHttpClient(connection);

        var url = BuildUrl(connection.BaseUrl, "/api2/delete");
        var body = new
        {
            game = connection.GameTitle,
            rawWord = rawText,
        };

        return await SendTermUpdateRequestAsync(httpClient, url, body).ConfigureAwait(false);
    }

    private static async Task<bool> SendTermUpdateRequestAsync(HttpClient httpClient, string url, object body)
    {
        var jsonBody = JsonSerializer.Serialize(body);
        using var content = new StringContent(jsonBody, Encoding.UTF8, "application/json");
        using var response = await httpClient.PostAsync(url, content).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();

        var responseText = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
        var apiResult = JsonSerializer.Deserialize<ApiResultDto>(responseText);
        if (apiResult is null)
        {
            throw new InvalidOperationException("远程术语 API 返回了无效响应。");
        }

        if (!apiResult.Success)
        {
            throw new InvalidOperationException("远程术语 API 返回失败。");
        }

        return true;
    }

    private sealed class ApiResultDto
    {
        [JsonPropertyName("success")]
        public bool Success { get; set; }

        [JsonPropertyName("project_id")]
        public string? ProjectId { get; set; }

        [JsonPropertyName("key")]
        public string? Key { get; set; }

        [JsonPropertyName("value")]
        public string? Value { get; set; }
    }

    private static string BuildUrl(string baseUrl, string path)
    {
        if (baseUrl.EndsWith("/", StringComparison.Ordinal) && path.StartsWith("/", StringComparison.Ordinal))
        {
            return baseUrl[..^1] + path;
        }

        if (!baseUrl.EndsWith("/", StringComparison.Ordinal) && !path.StartsWith("/", StringComparison.Ordinal))
        {
            return baseUrl + "/" + path;
        }

        return baseUrl + path;
    }
}
