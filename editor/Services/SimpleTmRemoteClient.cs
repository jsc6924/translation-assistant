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
        using var httpClient = new HttpClient();
        httpClient.Timeout = TimeSpan.FromSeconds(15);

        var authValue = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{connection.Username}:{connection.ApiToken}"));
        httpClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Basic", authValue);

        var terms = await FetchTermsAsync(httpClient, connection).ConfigureAwait(false);
        var naming = await FetchNamingRulesAsync(httpClient, connection).ConfigureAwait(false);
        return (terms, naming);
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
