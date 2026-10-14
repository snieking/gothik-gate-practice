// Build against CascLib. This extractor stays offline and reads the installed
// storage without changing it. Only requested files are copied to --output.
#include "CascLib.h"
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

int main(int argc, char** argv) {
    std::string storagePath;
    std::filesystem::path outputPath;
    std::vector<std::string> requests;
    for (int i = 1; i < argc; ++i) {
        const std::string argument(argv[i]);
        if (argument == "--storage" && i + 1 < argc) storagePath = argv[++i];
        else if (argument == "--output" && i + 1 < argc) outputPath = argv[++i];
        else requests.push_back(argument);
    }
    if (storagePath.empty() || outputPath.empty() || requests.empty()) {
        std::fprintf(stderr, "Usage: extractor --storage ERA_STORAGE_VIEW --output FOLDER FILE_OR_id:FDID ...\n");
        return 1;
    }
    CASC_OPEN_STORAGE_ARGS args = {};
    args.Size = sizeof(args);
    args.szLocalPath = storagePath.c_str();
    args.szCodeName = "wow_classic_era";
    args.dwLocaleMask = CASC_LOCALE_ENUS;
    args.dwFlags = 0;  // Never enable CASC_FEATURE_ONLINE or CDN fallback.
    HANDLE storage = nullptr;
    if (!CascOpenStorageEx(nullptr, &args, false, &storage)) {
        std::fprintf(stderr, "Offline Era storage open failed: %u\n", GetCascError());
        return 2;
    }
    CASC_STORAGE_PRODUCT product = {};
    DWORD features = 0;
    CascGetStorageInfo(storage, CascStorageProduct, &product, sizeof(product), nullptr);
    CascGetStorageInfo(storage, CascStorageFeatures, &features, sizeof(features), nullptr);
    if (features & CASC_FEATURE_ONLINE) {
        CascCloseStorage(storage);
        std::fprintf(stderr, "Refused online storage\n");
        return 3;
    }
    std::printf("Opened product %s, build %u, online feature disabled\n", product.szCodeName, product.BuildNumber);
    std::filesystem::create_directories(outputPath);
    bool complete = true;
    for (const auto& request : requests) {
        HANDLE file = nullptr;
        const bool byID = request.rfind("id:", 0) == 0;
        const DWORD id = byID ? static_cast<DWORD>(std::strtoul(request.c_str() + 3, nullptr, 10)) : 0;
        const void* name = byID ? CASC_FILE_DATA_ID(id) : request.c_str();
        const DWORD flags = (byID ? CASC_OPEN_BY_FILEID : CASC_OPEN_BY_NAME) | CASC_STRICT_DATA_CHECK;
        if (!CascOpenFile(storage, name, CASC_LOCALE_ENUS, flags, &file)) {
            std::fprintf(stderr, "Unavailable local file: %s, error %u\n", request.c_str(), GetCascError());
            complete = false;
            continue;
        }
        ULONGLONG size = 0;
        if (!CascGetFileSize64(file, &size) || size < 4 || size > 50000000) {
            std::fprintf(stderr, "Invalid size: %s\n", request.c_str());
            CascCloseFile(file);
            complete = false;
            continue;
        }
        std::vector<unsigned char> bytes(static_cast<size_t>(size));
        DWORD read = 0;
        if (!CascReadFile(file, bytes.data(), static_cast<DWORD>(size), &read) || read != size) {
            std::fprintf(stderr, "Read failed: %s, error %u\n", request.c_str(), GetCascError());
            complete = false;
        } else {
            // ID extracts use .blp as an opaque staging extension. The
            // converter checks magic rather than assuming every ID is BLP.
            const auto filename = byID ? std::to_string(id) + ".blp" : std::filesystem::path(request).filename().string();
            std::ofstream out(outputPath / filename, std::ios::binary);
            out.write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
            if (!out) complete = false;
            else std::printf("Extracted %s, %llu bytes\n", filename.c_str(), size);
        }
        CascCloseFile(file);
    }
    CascCloseStorage(storage);
    return complete ? 0 : 4;
}
